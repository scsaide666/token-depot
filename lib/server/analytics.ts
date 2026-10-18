import "server-only";
import { expireOwnedOrders } from "@/lib/payments/orders";
import { rechargeDto, rechargeSelect } from "@/lib/payments/reads";
import { paymentOptions } from "@/lib/payments/providers/config";
import { Prisma } from "@/generated/prisma/client";
import { money } from "@/lib/billing/money";
import type { AnalyticsRange, AnalyticsPoint, BillingData, OverviewData, UsageData, UsageQuery, UsageStats, PageQuery, PageInfo, RequestRecord } from "@/lib/analytics-types";
import { getDb } from "./db";
import { requireApiSession } from "./http";

type Tx = Prisma.TransactionClient;
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 };
function windowFor(range: AnalyticsRange, end = new Date()) {
  const buckets = range === "24H" ? 24 : range === "7D" ? 7 : 30;
  const seconds = range === "24H" ? 3600 : 86400;
  return { start: new Date(end.getTime() - buckets * seconds * 1000), end, buckets, seconds };
}
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
function predicate(userId: string, start: Date, end: Date, filters: Partial<UsageQuery> = {}) {
  return Prisma.sql`r."userId" = ${userId}::uuid AND r."createdAt" >= ${start} AND r."createdAt" < ${end}
    ${filters.modelId ? Prisma.sql`AND r."modelId" = ${filters.modelId}::uuid` : Prisma.empty}
    ${filters.apiKeyId ? Prisma.sql`AND r."apiKeyId" = ${filters.apiKeyId}::uuid` : Prisma.empty}
    ${filters.status ? Prisma.sql`AND r."status" = ${filters.status}::"ApiRequestStatus"` : Prisma.empty}`;
}
async function stats(tx: Tx, userId: string, start: Date, end: Date, filters: Partial<UsageQuery> = {}): Promise<UsageStats> {
  const [row] = await tx.$queryRaw<{ requests: bigint; tokens: bigint; spend: Prisma.Decimal; latency: Prisma.Decimal | null; failed: bigint; pending: bigint; completed: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS requests, COALESCE(SUM(r."totalTokens"),0)::bigint AS tokens,
      COALESCE(SUM(r."userCost"),0) AS spend,
      AVG(r."latencyMs") FILTER (WHERE r.status <> 'PENDING') AS latency,
      COUNT(*) FILTER (WHERE r.status = 'FAILED') AS failed,
      COUNT(*) FILTER (WHERE r.status = 'PENDING') AS pending,
      COUNT(*) FILTER (WHERE r.status <> 'PENDING') AS completed
      FROM "ApiRequest" r WHERE ${predicate(userId, start, end, filters)}`
  );
  return {
    requests: row.requests.toString(), tokens: row.tokens.toString(), spend: money(row.spend).toFixed(20),
    averageLatencyMs: row.latency === null ? null : money(row.latency).toDecimalPlaces(0).toNumber(),
    errorRate: row.completed.toString() === "0" ? "0.00" : money(row.failed.toString()).times("100").div(row.completed.toString()).toFixed(2),
    failedRequests: row.failed.toString(), pendingRequests: row.pending.toString(),
  };
}
async function chart(tx: Tx, userId: string, window: ReturnType<typeof windowFor>, filters: Partial<UsageQuery> = {}): Promise<AnalyticsPoint[]> {
  const rows = await tx.$queryRaw<{ bucket: number; requests: bigint; tokens: bigint; spend: Prisma.Decimal }[]>(
    Prisma.sql`SELECT floor(extract(epoch FROM (r."createdAt" - ${window.start}::timestamptz)) / ${window.seconds})::int AS bucket,
      COUNT(*) AS requests, COALESCE(SUM(r."totalTokens"),0)::bigint AS tokens, COALESCE(SUM(r."userCost"),0) AS spend
      FROM "ApiRequest" r WHERE ${predicate(userId, window.start, window.end, filters)} GROUP BY bucket ORDER BY bucket`
  );
  const lookup = new Map(rows.map((row) => [row.bucket, row]));
  const formatter = chartFormatter(window);
  return Array.from({ length: window.buckets }, (_, index) => {
    const row = lookup.get(index), date = new Date(window.start.getTime() + index * window.seconds * 1000);
    const label = formatter.format(date);
    return { date: date.toISOString(), label, requests: row?.requests.toString() ?? "0", tokens: row?.tokens.toString() ?? "0", spend: money(row?.spend ?? "0").toFixed(20) };
  });
}
function chartFormatter(window: ReturnType<typeof windowFor>) {
  return new Intl.DateTimeFormat("en-US", window.seconds === 3600
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" });
}
const requestSelect = {
  id: true, requestId: true, userId: true, modelSlug: true, inputTokens: true, outputTokens: true, totalTokens: true,
  userCost: true, latencyMs: true, status: true, createdAt: true, source: true,
  model: { select: { slug: true } }, apiKey: { select: { name: true, userId: true } },
} satisfies Prisma.ApiRequestSelect;
type Row = Prisma.ApiRequestGetPayload<{ select: typeof requestSelect }>;
function requestDto(row: Row): RequestRecord {
  return {
    id: row.id, requestId: row.requestId, model: row.modelSlug ?? row.model?.slug ?? "Unavailable model",
    apiKeyName: row.source === "PLAYGROUND" ? "Playground" : row.apiKey?.userId === row.userId ? row.apiKey.name : "Deleted or unavailable key",
    inputTokens: row.inputTokens, outputTokens: row.outputTokens, totalTokens: row.totalTokens,
    cost: row.userCost?.toFixed(20) ?? null, latencyMs: row.latencyMs, status: row.status, createdAt: row.createdAt.toISOString(),
  };
}
function requestWhere(userId: string, start: Date, end: Date, filters: Partial<UsageQuery> = {}): Prisma.ApiRequestWhereInput {
  return { userId, createdAt: { gte: start, lt: end }, ...(filters.modelId ? { modelId: filters.modelId } : {}), ...(filters.apiKeyId ? { apiKeyId: filters.apiKeyId } : {}), ...(filters.status ? { status: filters.status } : {}) };
}
function pageInfo(query: PageQuery, total: number): PageInfo {
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  return { page: Math.min(query.page, totalPages), pageSize: query.pageSize, total, totalPages };
}
async function spending(tx: Tx, userId: string, now: Date, monthOnly = false) {
  const [row] = await tx.$queryRaw<{ month: Prisma.Decimal; lifetime: Prisma.Decimal }[]>(
    Prisma.sql`SELECT COALESCE(-SUM(t.amount) FILTER (WHERE t."createdAt" >= ${monthStart(now)}),0) AS month,
      COALESCE(-SUM(t.amount),0) AS lifetime FROM "WalletTransaction" t JOIN "Wallet" w ON w.id = t."walletId"
      WHERE w."userId" = ${userId}::uuid AND t.type = 'USAGE' AND t."createdAt" < ${now}
      ${monthOnly ? Prisma.sql`AND t."createdAt" >= ${monthStart(now)}` : Prisma.empty}`
  );
  return { monthSpend: money(row.month).toFixed(20), lifetimeSpend: money(row.lifetime).toFixed(20) };
}
async function balance(tx: Tx, userId: string) {
  const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId }, select: { balance: true, reservedBalance: true } });
  return { availableBalance: money(wallet.balance).minus(money(wallet.reservedBalance)).toFixed(20), reservedBalance: wallet.reservedBalance.toFixed(20) };
}

// Every exported read derives ownership from the ACTIVE session. No caller userId exists.
export async function getOverview(range: AnalyticsRange): Promise<OverviewData> {
  const { user } = await requireApiSession(), now = new Date(), window = windowFor(range, now);
  return getDb().$transaction(async (tx) => {
    const [wallet, month, spend, points, recent] = await Promise.all([
      balance(tx, user.id), stats(tx, user.id, monthStart(now), now), spending(tx, user.id, now, true),
      chart(tx, user.id, window), tx.apiRequest.findMany({ where: { userId: user.id, createdAt: { lt: now } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5, select: requestSelect }),
    ]);
    return { ...wallet, month, monthSpend: spend.monthSpend, range, start: window.start.toISOString(), end: now.toISOString(), points, recentRequests: recent.map(requestDto) };
  }, transactionOptions);
}

export async function getUsage(query: UsageQuery): Promise<UsageData> {
  const { user } = await requireApiSession(), window = windowFor(query.range);
  return getDb().$transaction(async (tx) => {
    const where = requestWhere(user.id, window.start, window.end, query);
    const [summary, points, models, keys] = await Promise.all([
      stats(tx, user.id, window.start, window.end, query), chart(tx, user.id, window, query),
      tx.$queryRaw<{ value: string; label: string }[]>(Prisma.sql`SELECT r."modelId" AS value, COALESCE(MAX(r."modelSlug"),m.slug) AS label FROM "ApiRequest" r JOIN "Model" m ON m.id = r."modelId" WHERE r."userId" = ${user.id}::uuid GROUP BY r."modelId",m.slug ORDER BY label LIMIT 200`),
      tx.apiKey.findMany({ where: { userId: user.id }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 200 }),
    ]);
    const pagination = pageInfo(query, Number(summary.requests));
    const rows = await tx.apiRequest.findMany({ where, select: requestSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (pagination.page - 1) * query.pageSize, take: query.pageSize });
    return { query: { ...query, page: pagination.page }, start: window.start.toISOString(), end: window.end.toISOString(), stats: summary, points, requests: rows.map(requestDto), pagination, filters: { models, apiKeys: keys.map((key) => ({ value: key.id, label: key.name })) } };
  }, transactionOptions);
}

export async function getBilling(query: PageQuery & { rechargePage?: number }): Promise<BillingData> {
  const { user } = await requireApiSession(), now = new Date();
  await expireOwnedOrders(user.id);
  return getDb().$transaction(async (tx) => {
    const where: Prisma.WalletTransactionWhereInput = { wallet: { userId: user.id }, createdAt: { lt: now } };
    const [wallet, spend, total, rechargeTotal] = await Promise.all([balance(tx, user.id), spending(tx, user.id, now), tx.walletTransaction.count({ where }), tx.paymentOrder.count({ where: { userId: user.id } })]);
    const pagination = pageInfo(query, total);
    const rechargePagination = pageInfo({ page: query.rechargePage ?? 1, pageSize: query.pageSize }, rechargeTotal);
    const rows = await tx.walletTransaction.findMany({ where, select: { id: true, createdAt: true, type: true, amount: true, balanceAfter: true, description: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.pageSize, skip: (pagination.page - 1) * query.pageSize });
    const recharges = await tx.paymentOrder.findMany({ where: { userId: user.id }, select: rechargeSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.pageSize, skip: (rechargePagination.page - 1) * query.pageSize });
    return { ...wallet, ...spend, pagination, transactions: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), amount: row.amount.toFixed(20), balanceAfter: row.balanceAfter.toFixed(20) })), recharges: recharges.map(rechargeDto), rechargePagination, paymentOptions: paymentOptions() };
  }, transactionOptions);
}
