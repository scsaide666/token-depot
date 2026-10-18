import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type ProviderAttempt, type ProviderChannel, type ModelChannel } from "@/generated/prisma/client";
import { getDb } from "@/lib/server/db";
import { calculateCosts, money } from "@/lib/billing/money";
import { GatewayError, type TokenUsage } from "@/lib/ai/types";
import { providerFaults } from "./health";

type Tx = Prisma.TransactionClient;
const options = { maxWait: 15000, timeout: 15000 };
export type Candidate = ModelChannel & { channel: ProviderChannel };
export type Claim = { attempt: ProviderAttempt; channel: ProviderChannel };
const cappedLatency = (n: number) => Math.min(2147483647, Math.max(0, Math.round(n)));

async function lockChannel(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<ProviderChannel[]>`SELECT * FROM "ProviderChannel" WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw new GatewayError(503, "The upstream channel is unavailable.", "server_error", "provider_unavailable");
  return rows[0];
}

// This lock covers admission, rate budgets and the half-open probe across processes.
export async function claimAttempt(candidate: Candidate, requestId: string, attemptNumber: number, estimatedTokens: number, deadline: number): Promise<Claim | undefined> {
  return getDb().$transaction(async (tx) => {
    let channel = await lockChannel(tx, candidate.channelId);
    const now = new Date(), nowMs = now.getTime();
    const binding = await tx.modelChannel.findUnique({ where: { id: candidate.id }, include: { model: true } });
    if (!channel.enabled || channel.apiKeyEnv !== candidate.channel.apiKeyEnv || channel.baseUrlEnv !== candidate.channel.baseUrlEnv ||
      channel.idempotentRequests !== candidate.channel.idempotentRequests || !binding?.enabled || !binding.model.enabled ||
      channel.provider !== binding.model.provider || binding.providerModel !== candidate.providerModel ||
      binding.providerModel !== binding.model.providerModel || binding.contextWindow < binding.model.contextWindow ||
      channel.rateLimitedUntil && channel.rateLimitedUntil.getTime() > nowMs) return undefined;
    const request = await tx.apiRequest.findUnique({ where: { requestId }, select: { status: true, modelId: true } });
    if (request?.status !== "PENDING" || request.modelId !== binding.modelId) throw new GatewayError(409, "This request cannot be dispatched.", "server_error", "request_already_exists");

    const expired = await tx.providerAttempt.findMany({ where: { channelId: channel.id, status: "PENDING", expiresAt: { lte: now } }, select: { id: true } });
    if (expired.length) {
      await tx.providerAttempt.updateMany({ where: { id: { in: expired.map(a => a.id) }, status: "PENDING" }, data: { status: "FAILED", errorCode: "provider_attempt_expired", finishedAt: now } });
      // An abandoned dispatch remains an unknown cost. Never infer a free execution.
      channel = await tx.providerChannel.update({ where: { id: channel.id }, data: {
        consecutiveFailures: channel.consecutiveFailures + expired.length,
        ...(channel.consecutiveFailures + expired.length >= channel.failureThreshold ? { circuitState: "OPEN", circuitVersion: { increment: 1 }, openedUntil: new Date(nowMs + channel.cooldownMs), probeAttemptId: null, probeExpiresAt: null } : {}),
      } });
    }
    if (channel.circuitState === "OPEN" && (!channel.openedUntil || channel.openedUntil.getTime() > nowMs)) return undefined;
    if (channel.circuitState === "HALF_OPEN" && channel.probeAttemptId && channel.probeExpiresAt && channel.probeExpiresAt.getTime() > nowMs) return undefined;
    const counters = await tx.$queryRaw<{ rpm: bigint; tpm: bigint; concurrent: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE "createdAt" >= ${new Date(nowMs - 60000)})::bigint AS rpm,
        COALESCE(SUM(CASE WHEN "costStatus" = 'KNOWN' THEN "totalTokens" WHEN "executionState" = 'REJECTED' THEN 0 ELSE "estimatedTokens" END)
          FILTER (WHERE "createdAt" >= ${new Date(nowMs - 60000)}),0)::bigint AS tpm,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND "expiresAt" > ${now})::bigint AS concurrent
      FROM "ProviderAttempt" WHERE "channelId" = ${channel.id}::uuid AND ("createdAt" >= ${new Date(nowMs - 60000)} OR status = 'PENDING')
    `);
    const counts = counters[0];
    if (counts.rpm >= BigInt(channel.rpm) || counts.tpm + BigInt(estimatedTokens) > BigInt(channel.tpm) || counts.concurrent >= BigInt(channel.concurrency)) return undefined;
    const id = randomUUID();
    const halfOpen = channel.circuitState !== "CLOSED";
    const expiresAt = new Date(Math.min(deadline + 5000, nowMs + channel.timeoutMs + 5000));
    const prior = channel.idempotentRequests ? await tx.providerAttempt.findFirst({ where: { requestId, channelId: channel.id }, orderBy: { attemptNumber: "asc" } }) : null;
    if (prior && prior.providerModel !== binding.providerModel) return undefined;
    const attempt = await tx.providerAttempt.create({ data: {
      id, requestId, channelId: channel.id, bindingId: binding.id, attemptNumber,
      executionGroup: createHash("sha256").update(channel.idempotentRequests ? `${requestId}:${channel.id}` : id).digest("hex"),
      provider: channel.provider, providerModel: prior?.providerModel ?? binding.providerModel,
      inputPricePerMillion: prior?.inputPricePerMillion ?? binding.inputPricePerMillion,
      outputPricePerMillion: prior?.outputPricePerMillion ?? binding.outputPricePerMillion,
      estimatedTokens, providerCost: "0", circuitVersion: channel.circuitVersion, expiresAt,
    } });
    if (halfOpen) channel = await tx.providerChannel.update({ where: { id: channel.id }, data: { circuitState: "HALF_OPEN", probeAttemptId: id, probeExpiresAt: expiresAt } });
    return { attempt, channel };
  }, options);
}

export async function markDispatched(attemptId: string) {
  const updated = await getDb().providerAttempt.updateMany({ where: { id: attemptId, status: "PENDING", executionState: "NOT_SENT" }, data: {
    dispatchedAt: new Date(), executionState: "UNCERTAIN", costStatus: "PENDING_RECONCILIATION", providerCost: null,
  } });
  if (updated.count !== 1) throw new GatewayError(503, "The upstream attempt could not be confirmed.", "server_error", "routing_unavailable");
}

export async function finishAttempt(claim: Claim, latencyMs: number, outcome: { usage?: TokenUsage; error?: GatewayError }) {
  return getDb().$transaction(async (tx) => {
    const channel = await lockChannel(tx, claim.channel.id);
    const attempt = await tx.providerAttempt.findUniqueOrThrow({ where: { id: claim.attempt.id } });
    const confirmsExecution = !["NOT_SENT", "REJECTED"].includes(outcome.error?.providerFailure?.execution ?? "");
    if (attempt.status !== "PENDING") {
      if (!outcome.usage || attempt.costStatus !== "PENDING_RECONCILIATION") return attempt;
      // A lease may expire while the original process is still receiving usage.
      // Confirm the cost without reviving its failed request or charging again.
      const usage = outcome.usage, providerCost = calculateCosts(usage.inputTokens, usage.outputTokens, { ...attempt, markupMultiplier: "1" }).providerCost;
      const confirmed = await tx.providerAttempt.update({ where: { id: attempt.id }, data: {
        costStatus: "KNOWN", providerCost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
      } });
      if (confirmsExecution && claim.channel.idempotentRequests) await tx.providerAttempt.updateMany({ where: {
        requestId: attempt.requestId, executionGroup: attempt.executionGroup, status: "FAILED", costStatus: "PENDING_RECONCILIATION",
      }, data: { costStatus: "KNOWN", providerCost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } });
      const accounting = await attemptAccounting(tx, attempt.requestId);
      if (accounting) await tx.apiRequest.updateMany({ where: { requestId: attempt.requestId, status: { in: ["SUCCESS", "FAILED"] },
        settledAt: { not: null }, providerCostStatus: "PENDING_RECONCILIATION" }, data: accounting });
      return confirmed;
    }
    const now = new Date(), error = outcome.error, usage = outcome.usage;
    const notIncurred = !usage && ["NOT_SENT", "REJECTED"].includes(error?.providerFailure?.execution ?? "");
    const cost = usage ? calculateCosts(usage.inputTokens, usage.outputTokens, { ...attempt, markupMultiplier: "1" }).providerCost : notIncurred ? "0" : null;
    const finished = await tx.providerAttempt.update({ where: { id: attempt.id }, data: {
      status: error ? "FAILED" : "SUCCESS", finishedAt: now, latencyMs: cappedLatency(latencyMs),
      errorCode: error?.code ?? null, upstreamStatus: error?.providerFailure?.upstreamStatus ?? null,
      executionState: error ? error.providerFailure?.execution ?? "UNCERTAIN" : "COMPLETED",
      costStatus: usage ? "KNOWN" : notIncurred ? "NOT_INCURRED" : "PENDING_RECONCILIATION", providerCost: cost,
      inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null,
    } });
    if (usage && confirmsExecution && claim.channel.idempotentRequests) {
      // Same idempotency key denotes one execution. Resolve its previous timeout
      // only from execution-confirming usage. A rejected replay's zero usage
      // cannot establish the cost of an earlier uncertain execution.
      await tx.providerAttempt.updateMany({ where: { requestId: attempt.requestId, channelId: channel.id, executionGroup: attempt.executionGroup,
        status: "FAILED", costStatus: "PENDING_RECONCILIATION" }, data: {
        costStatus: "KNOWN", providerCost: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
      } });
    }
    // A late success may not reset a circuit opened by a newer generation.
    const currentGeneration = attempt.circuitVersion === channel.circuitVersion;
    const ownsProbe = channel.circuitState !== "HALF_OPEN" || channel.probeAttemptId === attempt.id;
    if (currentGeneration && ownsProbe) {
      if (!error && (channel.consecutiveFailures !== 0 || channel.circuitState !== "CLOSED" || channel.openedUntil || channel.probeAttemptId || channel.probeExpiresAt)) await tx.providerChannel.update({ where: { id: channel.id }, data: {
        consecutiveFailures: 0, circuitState: "CLOSED", openedUntil: null, probeAttemptId: null, probeExpiresAt: null,
      } });
      else if (error && providerFaults.includes(error.code)) {
        const failures = channel.consecutiveFailures + 1, trip = channel.circuitState === "HALF_OPEN" || failures >= channel.failureThreshold;
        await tx.providerChannel.update({ where: { id: channel.id }, data: {
          consecutiveFailures: failures,
          ...(error.code === "provider_rate_limit" ? { rateLimitedUntil: new Date(now.getTime() + Math.min(300, error.retryAfter ?? 60) * 1000) } : {}),
          ...(trip ? { circuitState: "OPEN", circuitVersion: { increment: 1 }, openedUntil: new Date(now.getTime() + channel.cooldownMs), probeAttemptId: null, probeExpiresAt: null } : {}),
        } });
      } else if (channel.circuitState === "HALF_OPEN") {
        // Client cancellation is not a provider failure, but must release the probe.
        await tx.providerChannel.update({ where: { id: channel.id }, data: { circuitState: "OPEN", openedUntil: new Date(now.getTime() + channel.cooldownMs), probeAttemptId: null, probeExpiresAt: null } });
      }
    }
    return finished;
  }, options);
}

export async function attemptAccounting(tx: Tx, requestId: string) {
  const groups = await tx.$queryRaw<{ cost: Prisma.Decimal | null; unknown: boolean; known: boolean }[]>(Prisma.sql`
    SELECT MAX("providerCost") AS cost, BOOL_OR("costStatus" = 'PENDING_RECONCILIATION') AS unknown, BOOL_OR("costStatus" = 'KNOWN') AS known
    FROM "ProviderAttempt" WHERE "requestId" = ${requestId}::uuid GROUP BY "executionGroup"
  `);
  if (!groups.length) return undefined;
  if (groups.some(g => g.unknown)) return { providerCost: null, providerCostStatus: "PENDING_RECONCILIATION" as const };
  const sum = groups.reduce((s, g) => s.plus(g.cost?.toString() ?? "0"), money("0"));
  return { providerCost: sum.toFixed(20), providerCostStatus: groups.some(g => g.known) ? "KNOWN" as const : "NOT_INCURRED" as const };
}
