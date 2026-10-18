import "server-only";
import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getDb } from "@/lib/server/db";
import { money, calculateCosts } from "@/lib/billing/money";
import type { BillingModel } from "@/lib/billing/budget";
import { GatewayError, streamError, type AIProvider, type ProviderContext, type ChatCompletionInput, type NormalizedCompletion, type TokenUsage } from "@/lib/ai/types";
import { getProvider } from "./index";
import { channelAdapter, channelConfigured, channelDefaults, envPrefix } from "./channel-config";
import { channelHealth, routingStatistics } from "./health";
import { claimAttempt, finishAttempt, markDispatched, type Candidate, type Claim } from "./attempts";
import { retryDecision } from "./retry";

const routeUnavailable = () => new GatewayError(503, "No compatible upstream channel is currently available.", "server_error", "provider_unavailable", 5, undefined, { execution: "NOT_SENT" });
const limited = () => new GatewayError(429, "The upstream channel capacity is currently limited.", "rate_limit_error", "provider_rate_limit", 5, undefined, { execution: "NOT_SENT" });
export type RoutePlan = { model: BillingModel; candidates: Candidate[] };

export async function prepareRoute(model: BillingModel): Promise<RoutePlan> {
  const db = getDb();
  let bindings = await db.modelChannel.findMany({ where: { modelId: model.id }, include: { channel: true }, take: 21 });
  if (!bindings.length) {
    // Preserve existing routes when adding a model. Once explicit bindings exist,
    // disabling them never falls back to an untracked legacy route.
    getProvider(model.provider);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Model" WHERE id = ${model.id}::uuid FOR UPDATE`;
      if (await tx.modelChannel.count({ where: { modelId: model.id } })) return;
      const prefix = envPrefix[model.provider], configuredTimeout = Number(process.env[`${prefix}_TIMEOUT_MS`] ?? "90000");
      const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout >= 100 && configuredTimeout <= 120000 ? configuredTimeout : 90000;
      const channel = await tx.providerChannel.upsert({ where: { code: `${model.provider.toLowerCase()}-primary` }, update: {}, create: {
        code: `${model.provider.toLowerCase()}-primary`, name: `${model.provider} Primary`, provider: model.provider,
        apiKeyEnv: `${prefix}_API_KEY`, baseUrlEnv: `${prefix}_BASE_URL`, timeoutMs, ...channelDefaults(),
      } });
      await tx.modelChannel.create({ data: { modelId: model.id, channelId: channel.id, providerModel: model.providerModel, contextWindow: model.contextWindow,
        inputPricePerMillion: model.inputPricePerMillion, outputPricePerMillion: model.outputPricePerMillion } });
    }, { maxWait: 15000, timeout: 15000 });
    bindings = await db.modelChannel.findMany({ where: { modelId: model.id }, include: { channel: true }, take: 21 });
  }
  if (bindings.length > 20) throw routeUnavailable();
  const compatible = bindings.filter(b => b.enabled && b.channel.enabled && b.channel.provider === model.provider &&
    b.providerModel === model.providerModel && b.contextWindow >= model.contextWindow);
  const candidates = compatible.filter(b => channelConfigured(b.channel));
  if (!candidates.length) {
    if (compatible.length) throw new GatewayError(503, "This model's provider is not configured.", "server_error", "provider_not_configured");
    throw routeUnavailable();
  }
  return { model, candidates };
}

async function rankedCandidates(plan: RoutePlan, input: ChatCompletionInput, estimatedTokens: number, exclude: Set<string>, pinned?: string) {
  const latest = await getDb().modelChannel.findMany({ where: { id: { in: plan.candidates.map(b => b.id) }, enabled: true }, include: { channel: true } });
  const metrics = await routingStatistics(latest.map(b => b.channelId));
  const rows = latest.filter(b => {
    const original = plan.candidates.find(c => c.id === b.id)!;
    return b.channel.apiKeyEnv === original.channel.apiKeyEnv && b.channel.baseUrlEnv === original.channel.baseUrlEnv &&
    b.channel.idempotentRequests === original.channel.idempotentRequests &&
    !exclude.has(b.channelId) && (!pinned || b.channelId === pinned) && b.channel.enabled && channelConfigured(b.channel) &&
    b.channel.provider === plan.model.provider && b.providerModel === plan.model.providerModel && b.contextWindow >= plan.model.contextWindow &&
    !(b.channel.rateLimitedUntil && b.channel.rateLimitedUntil.getTime() > Date.now()) &&
    !(b.channel.circuitState === "OPEN" && (!b.channel.openedUntil || b.channel.openedUntil.getTime() > Date.now()));
  });
  const outputTokens = input.max_completion_tokens ?? input.max_tokens ?? 1024;
  const decorated = rows.map(b => ({ binding: b, health: channelHealth(b.channel, true, metrics.get(b.channelId)!),
    latency: metrics.get(b.channelId)!.averageLatency ?? 3000,
    cost: money(calculateCosts(Math.max(0, estimatedTokens - outputTokens), outputTokens, { ...b, markupMultiplier: "1" }).providerCost) }));
  const compare = (x: typeof decorated[number], y: typeof decorated[number]) =>
    (x.health === "Healthy" ? 0 : 1) - (y.health === "Healthy" ? 0 : 1) ||
    Number(y.binding.preferred) - Number(x.binding.preferred) ||
    x.binding.channel.priority - y.binding.channel.priority ||
    Math.floor(x.latency / 1000) - Math.floor(y.latency / 1000) || x.cost.comparedTo(y.cost);
  decorated.sort(compare);
  // Apply weights only among equally ranked channels, preserving health, latency
  // and cost preferences rather than sending weight-biased traffic to a fault.
  const ordered: Candidate[] = [];
  while (decorated.length) {
    const first = decorated[0], peers = decorated.filter(row => compare(first, row) === 0);
    let draw = randomInt(peers.reduce((sum, row) => sum + row.binding.channel.weight, 0));
    const chosen = peers.find(row => (draw -= row.binding.channel.weight) < 0)!;
    ordered.push(chosen.binding); decorated.splice(decorated.indexOf(chosen), 1);
  }
  // One cooled circuit may probe even when a preferred/fast backup would otherwise
  // starve it forever. Admission serializes the lease; other requests use backups.
  const probeIndex = ordered.findIndex(b => b.channel.circuitState === "OPEN" ||
    b.channel.circuitState === "HALF_OPEN" && (!b.channel.probeExpiresAt || b.channel.probeExpiresAt.getTime() <= Date.now()));
  if (probeIndex > 0) ordered.unshift(...ordered.splice(probeIndex, 1));
  return ordered;
}

function maxAttempts() {
  const retries = Number(process.env.ROUTER_MAX_RETRIES ?? "2");
  return 1 + (Number.isInteger(retries) && retries >= 0 && retries <= 2 ? retries : 2);
}
function aborted(signal: AbortSignal, deadline: AbortSignal) {
  return new GatewayError(signal.aborted && !deadline.aborted ? 499 : 504,
    signal.aborted && !deadline.aborted ? "The request was cancelled." : "The upstream provider timed out.",
    signal.aborted && !deadline.aborted ? "invalid_request_error" : "server_error",
    signal.aborted && !deadline.aborted ? "request_cancelled" : "provider_timeout", undefined, undefined, { execution: "NOT_SENT" });
}

type DispatchContext = { requestId: string; signal: AbortSignal; estimatedTokens: number; onDispatch: () => void };
async function dispatchRoute<T>(plan: RoutePlan, input: ChatCompletionInput, context: DispatchContext,
  call: (provider: AIProvider, context: ProviderContext) => Promise<T>, usageOf: (value: T) => TokenUsage | undefined, deferred = false) {
  const deadlineAt = Date.now() + 120000, deadline = AbortSignal.timeout(120000), signal = AbortSignal.any([context.signal, deadline]);
  const exclude = new Set<string>();
  let pinned: string | undefined, lastError: GatewayError | undefined;
  const limit = maxAttempts();
  for (let number = 1; number <= limit; number++) {
    if (signal.aborted) throw lastError ?? aborted(context.signal, deadline);
    const candidates = await rankedCandidates(plan, input, context.estimatedTokens, exclude, pinned);
    let claim: Claim | undefined;
    for (const candidate of candidates) {
      claim = await claimAttempt(candidate, context.requestId, number, context.estimatedTokens, deadlineAt);
      if (claim) break;
    }
    if (!claim) throw lastError ?? (candidates.length ? limited() : routeUnavailable());
    const started = performance.now();
    let result: T | undefined, failure: GatewayError | undefined, dispatched = false;
    try {
      const provider = channelAdapter(claim.channel);
      if (signal.aborted) throw aborted(context.signal, deadline);
      await markDispatched(claim.attempt.id);
      dispatched = true;
      context.onDispatch();
      result = await call(provider, { requestId: context.requestId, providerModel: claim.attempt.providerModel, signal,
        ...(claim.channel.idempotentRequests ? { idempotencyKey: context.requestId } : {}) });
    } catch (error) {
      failure = error instanceof GatewayError ? error : new GatewayError(503, "The upstream attempt could not be confirmed.", "server_error", "routing_unavailable");
      if (deadline.aborted && failure.code === "request_cancelled") failure = new GatewayError(504, "The upstream provider timed out.", "server_error", "provider_timeout", undefined, failure.usage, failure.providerFailure);
      // Configuration/admission errors before markDispatched are known not to have
      // executed. Do not misclassify a durable dispatched attempt after a DB error.
      if (!dispatched) failure = new GatewayError(failure.status, failure.message, failure.type, failure.code, failure.retryAfter, failure.usage, { execution: "NOT_SENT" });
    }
    if (result === undefined || !deferred) await finishAttempt(claim, performance.now() - started, { usage: result === undefined ? failure?.usage : usageOf(result), error: failure });
    if (result !== undefined) return { result, claim, started, signal };
    lastError = failure!;
    const decision = retryDecision(lastError, claim.channel.idempotentRequests, number, limit);
    if (decision === "STOP") throw lastError;
    if (decision === "SAME_IDEMPOTENT_CHANNEL") pinned = claim.channel.id;
    else {
      // A later rejected replay cannot prove that an earlier uncertain attempt
      // did not execute. Keep that execution on its original idempotent channel.
      if (pinned) throw lastError;
      exclude.add(claim.channel.id);
    }
    try { await delay(Math.min(1500, 150 * 2 ** (number - 1)) + randomInt(100), undefined, { signal }); }
    catch { throw lastError; }
  }
  throw lastError ?? routeUnavailable();
}

export async function executeRoute(plan: RoutePlan, input: ChatCompletionInput, context: DispatchContext): Promise<NormalizedCompletion> {
  return (await dispatchRoute(plan, input, context, (provider, upstream) => provider.chatCompletion(input, upstream), value => value.usage)).result;
}

// Prime one normalized event before committing SSE headers. HTTP errors still
// return normal statuses and can follow the same bounded, execution-safe policy.
export async function openStreamRoute(plan: RoutePlan, input: ChatCompletionInput, context: DispatchContext) {
  return dispatchRoute(plan, input, context, async (provider, upstream) => {
    const source = await provider.streamChatCompletion(input, upstream), iterator = source[Symbol.asyncIterator]();
    try {
      const first = await iterator.next();
      if (first.done) throw streamError();
      return { source, iterator, first: first.value };
    } catch (error) { await iterator.return?.().catch(() => {}); throw error; }
  }, () => undefined, true);
}
export type StreamRoute = Awaited<ReturnType<typeof openStreamRoute>>;
