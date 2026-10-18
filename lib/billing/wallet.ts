import "server-only";
import type { ApiRequest, ApiRequestSource, Prisma, Wallet } from "@/generated/prisma/client";
import { getDb } from "@/lib/server/db";
import { GatewayError, type ChatCompletionInput, type TokenUsage } from "@/lib/ai/types";
import { estimateBudget, type BillingModel } from "./budget";
import { calculateCosts, money } from "./money";
import { attemptAccounting } from "@/lib/ai/router/attempts";

type Tx = Prisma.TransactionClient;
type Identity = { userId: string; apiKeyId: string | null; source?: ApiRequestSource };
const transactionOptions = { maxWait: 30000, timeout: 15000 };
const latency = (value: number) => Math.min(2147483647, Math.max(0, Math.round(value)));

// Settlement locks wallet, key, then request. Network I/O never holds these locks.
async function lockWallet(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<Wallet[]>`SELECT * FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new GatewayError(503, "The account wallet is unavailable.", "server_error", "wallet_unavailable");
  return rows[0];
}

async function lockRequest(tx: Tx, userId: string, requestId: string) {
  // Key deletion takes the key lock before its FK updates on ApiRequest. Match that
  // order so deleting an in-flight key cannot deadlock against Last Used updates.
  const hint = await tx.apiRequest.findFirst({ where: { requestId, userId }, select: { apiKeyId: true } });
  if (hint?.apiKeyId) await tx.$queryRaw`SELECT "id" FROM "ApiKey" WHERE "id" = ${hint.apiKeyId}::uuid AND "userId" = ${userId}::uuid FOR NO KEY UPDATE`;
  const rows = await tx.$queryRaw<ApiRequest[]>`SELECT * FROM "ApiRequest" WHERE "requestId" = ${requestId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new GatewayError(404, "Request not found.", "invalid_request_error", "request_not_found");
  return rows[0];
}

async function releaseAbandoned(tx: Tx, wallet: Wallet) {
  const now = new Date();
  const stale = await tx.apiRequest.findMany({ where: { userId: wallet.userId, status: "PENDING", reservationExpiresAt: { lte: now } } });
  if (!stale.length) return wallet;
  const release = stale.reduce((sum, record) => sum.plus(money(record.reservedAmount)), money("0"));
  const remaining = money(wallet.reservedBalance).minus(release);
  if (remaining.isNegative()) throw new Error("Wallet reservation invariant failed.");
  for (const record of stale) await tx.apiRequest.update({ where: { id: record.id, userId: wallet.userId }, data: {
    status: "FAILED", errorCode: "reservation_expired", userCost: "0", settledAt: now, latencyMs: latency(now.getTime() - record.createdAt.getTime()),
    ...await attemptAccounting(tx, record.requestId),
  } });
  return tx.wallet.update({ where: { id: wallet.id, userId: wallet.userId }, data: { reservedBalance: remaining.toFixed(20) } });
}

// Callable by a trusted recovery job; the next reservation also recovers this user's
// abandoned holds. No payment or balance-credit endpoint is exposed.
export async function recoverExpiredReservations(userId: string) {
  return getDb().$transaction(async (tx) => releaseAbandoned(tx, await lockWallet(tx, userId)), transactionOptions);
}

export async function reserveRequest(requestId: string, identity: Identity, model: BillingModel, input: ChatCompletionInput) {
  const budget = estimateBudget(input, model);
  const admitted = await getDb().$transaction(async (tx) => {
    const wallet = await releaseAbandoned(tx, await lockWallet(tx, identity.userId));
    // A duplicate cannot create another hold or dispatch another upstream call.
    if (await tx.apiRequest.findUnique({ where: { requestId }, select: { id: true } })) throw new GatewayError(409, "This request already exists.", "invalid_request_error", "request_already_exists");
    if (money(wallet.balance).minus(money(wallet.reservedBalance)).lt(money(budget.reservedAmount))) return false;
    await tx.wallet.update({ where: { id: wallet.id, userId: identity.userId }, data: { reservedBalance: money(wallet.reservedBalance).plus(money(budget.reservedAmount)).toFixed(20) } });
    await tx.apiRequest.create({ data: {
      requestId, userId: identity.userId, apiKeyId: identity.apiKeyId, source: identity.source ?? "API", modelId: model.id, provider: model.provider,
      status: "PENDING", latencyMs: 0, reservedAmount: budget.reservedAmount,
      modelSlug: model.slug, inputPricePerMillion: model.inputPricePerMillion, outputPricePerMillion: model.outputPricePerMillion, markupMultiplier: model.markupMultiplier,
      estimatedInputTokens: budget.estimatedInputTokens, maxOutputTokens: budget.maxOutputTokens, modelContextWindow: model.contextWindow,
      reservationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    } });
    return true;
  }, transactionOptions);
  if (!admitted) throw new GatewayError(402, "Insufficient available balance.", "billing_error", "insufficient_balance");
  return budget;
}

function snapshot(record: ApiRequest) {
  if (record.inputPricePerMillion === null || record.outputPricePerMillion === null || record.markupMultiplier === null || !record.modelSlug || record.maxOutputTokens === null || record.modelContextWindow === null) throw new Error("Billing snapshot is missing.");
  return { inputPricePerMillion: record.inputPricePerMillion, outputPricePerMillion: record.outputPricePerMillion, markupMultiplier: record.markupMultiplier };
}

async function touchKey(tx: Tx, record: ApiRequest) {
  if (record.apiKeyId) await tx.apiKey.updateMany({ where: { id: record.apiKeyId, userId: record.userId }, data: { lastUsedAt: new Date() } });
}

async function releaseFailure(tx: Tx, wallet: Wallet, record: ApiRequest, errorCode: string, latencyMs: number, usage?: TokenUsage, notSent = false) {
  const remaining = money(wallet.reservedBalance).minus(money(record.reservedAmount));
  if (remaining.isNegative()) throw new Error("Wallet reservation invariant failed.");
  const providerCost = usage ? calculateCosts(usage.inputTokens, usage.outputTokens, snapshot(record)).providerCost : null;
  const accounting = await attemptAccounting(tx, record.requestId) ?? { providerCost: notSent && !usage ? "0" : providerCost,
    providerCostStatus: usage ? "KNOWN" as const : notSent ? "NOT_INCURRED" as const : "PENDING_RECONCILIATION" as const };
  await tx.wallet.update({ where: { id: wallet.id, userId: record.userId }, data: { reservedBalance: remaining.toFixed(20) } });
  await touchKey(tx, record);
  return tx.apiRequest.update({ where: { id: record.id, userId: record.userId }, data: {
    status: "FAILED", settledAt: new Date(), errorCode, latencyMs: latency(latencyMs), ...accounting, userCost: "0",
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null,
  } });
}

export async function settleFailure(userId: string, requestId: string, errorCode: string, latencyMs: number, usage?: TokenUsage, notSent = false) {
  return getDb().$transaction(async (tx) => {
    const wallet = await lockWallet(tx, userId), record = await lockRequest(tx, userId, requestId);
    if (record.status !== "PENDING") return record;
    return releaseFailure(tx, wallet, record, errorCode, latencyMs, usage, notSent);
  }, transactionOptions);
}

export async function settleSuccess(userId: string, requestId: string, usage: TokenUsage, latencyMs: number, signal?: AbortSignal) {
  try {
    return await getDb().$transaction(async (tx) => {
      const wallet = await lockWallet(tx, userId), record = await lockRequest(tx, userId, requestId);
      // A terminal request returns its original result. Different retry parameters cannot
      // rewrite the charge, revive a failure or release another request's reservation.
      if (record.status !== "PENDING") return record;
      if (signal?.aborted) return releaseFailure(tx, wallet, record, "request_cancelled", latencyMs, usage);
      const prices = snapshot(record);
      if (!Number.isInteger(usage.totalTokens) || usage.inputTokens + usage.outputTokens !== usage.totalTokens || usage.totalTokens > 2147483647) throw new Error("Invalid usage totals.");
      const costs = calculateCosts(usage.inputTokens, usage.outputTokens, prices);
      const accounting = await attemptAccounting(tx, requestId) ?? { providerCost: costs.providerCost, providerCostStatus: "KNOWN" as const };
      const remainingReserve = money(wallet.reservedBalance).minus(money(record.reservedAmount));
      if (remainingReserve.isNegative()) throw new Error("Wallet reservation invariant failed.");
      const charge = money(costs.userCost), availableAfterRelease = money(wallet.balance).minus(remainingReserve);
      // Unexpected upstream framing can exceed the estimate. Consume only unreserved
      // funds under the same lock; never consume another request's hold or overdraft.
      if (usage.outputTokens > record.maxOutputTokens! || usage.totalTokens > record.modelContextWindow!) return releaseFailure(tx, wallet, record, "provider_usage_exceeded", latencyMs, usage);
      if (charge.gt(availableAfterRelease)) return releaseFailure(tx, wallet, record, "billing_limit_exceeded", latencyMs, usage);
      const before = money(wallet.balance), after = before.minus(charge);
      await tx.wallet.update({ where: { id: wallet.id, userId }, data: { balance: after.toFixed(20), reservedBalance: remainingReserve.toFixed(20) } });
      await tx.walletTransaction.create({ data: {
        walletId: wallet.id, requestId, type: "USAGE", amount: charge.negated().toFixed(20), balanceBefore: before.toFixed(20), balanceAfter: after.toFixed(20),
        model: record.modelSlug!, description: `API usage: ${record.modelSlug}`,
      } });
      await touchKey(tx, record);
      const settled = await tx.apiRequest.update({ where: { id: record.id, userId }, data: {
        status: "SUCCESS", settledAt: new Date(), errorCode: null, latencyMs: latency(latencyMs), ...costs, ...accounting,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
      } });
      // Observe cancellation again before the transaction can commit. Once a
      // terminal ledger has committed, subsequent disconnects cannot rewrite it.
      if (signal?.aborted) throw new GatewayError(499, "The request was cancelled.", "invalid_request_error", "request_cancelled", undefined, usage);
      return settled;
    }, transactionOptions);
  } catch (error) {
    if (error instanceof GatewayError && error.code === "request_cancelled" && signal?.aborted)
      return settleFailure(userId, requestId, error.code, latencyMs, usage);
    throw error;
  }
}
