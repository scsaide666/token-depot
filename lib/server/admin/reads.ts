import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { money } from "@/lib/billing/money";
import type { AdminDates, AdminUserQuery, AdminRequestQuery, AdminPaymentQuery, AdminModelQuery, AdminUserRecord, AdminRequestRecord, AdminPaymentRecord, FinancialStats, AdminOverviewData, AdminUsersData, AdminRequestsData, AdminPaymentsData, AdminModelsData } from "@/lib/admin-types";
import type { PageInfo } from "@/lib/analytics-types";
import { getDb } from "../db";
import { HttpError, requireAdminApiSession } from "../http";
import { adminRecord } from "../models";
import { adminWindow } from "./query";

type Tx = Prisma.TransactionClient;
const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const literal = (value: string) => value.replace(/[\\%_]/g, "\\$&");
function pagination(query: { page: number; pageSize: number }, total: number): PageInfo { const totalPages = Math.max(1, Math.ceil(total / query.pageSize)); return { page: Math.min(query.page, totalPages), pageSize: query.pageSize, total, totalPages }; }
function requestPredicate(window: { start: Date; end: Date }, query: Partial<AdminRequestQuery> = {}) {
  return Prisma.sql`r."createdAt" >= ${window.start} AND r."createdAt" < ${window.end}
    ${query.userId ? Prisma.sql`AND r."userId" = ${query.userId}::uuid` : Prisma.empty}
    ${query.modelId ? uuid.test(query.modelId) ? Prisma.sql`AND r."modelId" = ${query.modelId}::uuid` : Prisma.sql`AND (r."modelSlug" = ${query.modelId} OR r."modelId" IN (SELECT id FROM "Model" WHERE slug = ${query.modelId}))` : Prisma.empty}
    ${query.status ? Prisma.sql`AND r.status = ${query.status}::"ApiRequestStatus"` : Prisma.empty}`;
}
type StatsRow = { requests: bigint; tokens: bigint; revenue: Prisma.Decimal; providerCost: Prisma.Decimal; unknownCosts: bigint };
function statsDto(row: StatsRow): FinancialStats {
  const revenue = money(row.revenue), providerCost = money(row.providerCost);
  return { requests: row.requests.toString(), tokens: row.tokens.toString(), revenue: revenue.toFixed(20), providerCost: providerCost.toFixed(20), profit: revenue.minus(providerCost).toFixed(20), unknownCosts: row.unknownCosts.toString() };
}
const statsColumns = Prisma.sql`COUNT(*) AS requests, COALESCE(SUM(r."totalTokens"),0)::bigint AS tokens,
  COALESCE(SUM(r."userCost") FILTER (WHERE r."settledAt" IS NOT NULL),0) AS revenue,
  COALESCE(SUM(r."providerCost") FILTER (WHERE r."settledAt" IS NOT NULL),0) AS "providerCost",
  COUNT(*) FILTER (WHERE r.status <> 'PENDING' AND (r."userCost" IS NULL OR r."providerCost" IS NULL)) AS "unknownCosts"`;
async function stats(tx: Tx, window: { start: Date; end: Date }, query: Partial<AdminRequestQuery> = {}) {
  const [row] = await tx.$queryRaw<StatsRow[]>(Prisma.sql`SELECT ${statsColumns} FROM "ApiRequest" r WHERE ${requestPredicate(window, query)}`);
  return statsDto(row);
}
const userSelect = { id: true, name: true, email: true, status: true, createdAt: true, wallet: { select: { id: true, balance: true, reservedBalance: true } } } satisfies Prisma.UserSelect;
type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;
async function usersDto(tx: Tx, rows: UserRow[]): Promise<AdminUserRecord[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id), wallets = rows.flatMap((row) => row.wallet ? [row.wallet.id] : []);
  const [requests, spending] = await Promise.all([
    tx.apiRequest.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true } }),
    tx.walletTransaction.groupBy({ by: ["walletId"], where: { walletId: { in: wallets }, type: "USAGE" }, _sum: { amount: true } }),
  ]);
  const counts = new Map(requests.map((row) => [row.userId, row._count._all.toString()]));
  const spends = new Map(spending.map((row) => [row.walletId, money(row._sum.amount ?? "0").negated().toFixed(20)]));
  return rows.map((row) => ({ id: row.id, name: row.name, email: row.email, status: row.status, createdAt: row.createdAt.toISOString(),
    balance: row.wallet?.balance.toFixed(20) ?? "0", reservedBalance: row.wallet?.reservedBalance.toFixed(20) ?? "0", availableBalance: money(row.wallet?.balance ?? "0").minus(money(row.wallet?.reservedBalance ?? "0")).toFixed(20),
    lifetimeSpend: row.wallet ? spends.get(row.wallet.id) ?? "0" : "0", requests: counts.get(row.id) ?? "0" }));
}
const requestSelect = {
  id: true, requestId: true, inputTokens: true, outputTokens: true, userCost: true, providerCost: true, latencyMs: true, status: true, modelSlug: true, createdAt: true,
  user: { select: { id: true, name: true, email: true } }, model: { select: { slug: true } },
} satisfies Prisma.ApiRequestSelect;
function requestDto(row: Prisma.ApiRequestGetPayload<{ select: typeof requestSelect }>): AdminRequestRecord {
  return { id: row.id, requestId: row.requestId, user: row.user, model: row.modelSlug ?? row.model?.slug ?? "Unavailable model", inputTokens: row.inputTokens, outputTokens: row.outputTokens,
    userCost: row.userCost?.toFixed(20) ?? null, providerCost: row.providerCost?.toFixed(20) ?? null, profit: row.userCost === null || row.providerCost === null ? null : money(row.userCost).minus(money(row.providerCost)).toFixed(20),
    latencyMs: row.latencyMs, status: row.status, createdAt: row.createdAt.toISOString() };
}
function requestsWhere(window: { start: Date; end: Date }, query: Partial<AdminRequestQuery>): Prisma.ApiRequestWhereInput {
  return { createdAt: { gte: window.start, lt: window.end }, ...(query.userId ? { userId: query.userId } : {}), ...(query.status ? { status: query.status } : {}),
    ...(query.modelId ? uuid.test(query.modelId) ? { modelId: query.modelId } : { OR: [{ modelSlug: query.modelId }, { model: { slug: query.modelId } }] } : {}) };
}
export async function getAdminUsers(query: AdminUserQuery): Promise<AdminUsersData> {
  await requireAdminApiSession();
  return getDb().$transaction(async (tx) => {
    const where: Prisma.UserWhereInput = { ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ name: { contains: literal(query.search), mode: "insensitive" } }, { email: { contains: literal(query.search), mode: "insensitive" } }] } : {}) };
    const total = await tx.user.count({ where }), page = pagination(query, total);
    const rows = await tx.user.findMany({ where, select: userSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize });
    return { query: { ...query, page: page.page }, pagination: page, users: await usersDto(tx, rows) };
  }, options);
}
export async function getAdminUser(id: string) {
  await requireAdminApiSession();
  return getDb().$transaction(async (tx) => {
    const row = await tx.user.findUnique({ where: { id }, select: userSelect });
    if (!row) throw new HttpError(404, "User not found.");
    return (await usersDto(tx, [row]))[0];
  }, options);
}
export async function getAdminRequests(query: AdminRequestQuery): Promise<AdminRequestsData> {
  await requireAdminApiSession(); const window = adminWindow(query);
  return getDb().$transaction(async (tx) => {
    const where = requestsWhere(window, query), total = await tx.apiRequest.count({ where }), page = pagination(query, total);
    const [summary, rows] = await Promise.all([stats(tx, window, query), tx.apiRequest.findMany({ where, select: requestSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize })]);
    return { query: { ...query, page: page.page }, requests: rows.map(requestDto), stats: summary, pagination: page };
  }, options);
}
export async function getAdminPayments(query: AdminPaymentQuery): Promise<AdminPaymentsData> {
  await requireAdminApiSession(); const window = adminWindow(query);
  return getDb().$transaction(async (tx) => {
    const where: Prisma.PaymentOrderWhereInput = { createdAt: { gte: window.start, lt: window.end }, ...(query.userId ? { userId: query.userId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.method ? { method: query.method } : {}) };
    const total = await tx.paymentOrder.count({ where }), page = pagination(query, total);
    const rows = await tx.paymentOrder.findMany({ where, select: { id: true, orderNo: true, method: true, amount: true, status: true, paidAt: true, createdAt: true, user: { select: { id: true, name: true, email: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize });
    const payments: AdminPaymentRecord[] = rows.map((row) => ({ id: row.id, orderId: row.orderNo, user: row.user, method: row.method, amount: row.amount.toFixed(2), status: row.status, paidAt: row.paidAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }));
    return { query: { ...query, page: page.page }, payments, pagination: page };
  }, options);
}
export async function getAdminModels(query: AdminModelQuery): Promise<AdminModelsData> {
  await requireAdminApiSession(); const window = query.from || query.to ? adminWindow(query) : undefined;
  return getDb().$transaction(async (tx) => {
    const where: Prisma.ModelWhereInput = { ...(query.provider ? { provider: query.provider } : {}), ...(query.search ? { OR: ["name", "slug", "providerModel"].map((field) => ({ [field]: { contains: literal(query.search!), mode: "insensitive" } })) } : {}) };
    const total = await tx.model.count({ where }), page = pagination(query, total);
    const rows = await tx.model.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: page.pageSize, skip: (page.page - 1) * page.pageSize });
    const summary = rows.length ? await tx.$queryRaw<(StatsRow & { modelId: string })[]>(Prisma.sql`SELECT r."modelId", ${statsColumns} FROM "ApiRequest" r
      WHERE r."modelId" IN (${Prisma.join(rows.map((row) => Prisma.sql`${row.id}::uuid`))}) ${window ? Prisma.sql`AND ${requestPredicate(window)}` : Prisma.empty} GROUP BY r."modelId"`) : [];
    const values = new Map(summary.map((row) => [row.modelId, statsDto(row)]));
    const zero = statsDto({ requests: BigInt(0), tokens: BigInt(0), revenue: new Prisma.Decimal(0), providerCost: new Prisma.Decimal(0), unknownCosts: BigInt(0) });
    return { query: { ...query, page: page.page }, models: rows.map((row) => ({ ...adminRecord(row), stats: values.get(row.id) ?? zero })), pagination: page };
  }, options);
}
export async function getAdminOverview(query: AdminDates): Promise<AdminOverviewData> {
  await requireAdminApiSession(); const now = new Date(), window = adminWindow(query, now, 7), today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return getDb().$transaction(async (tx) => {
    const [totalUsers, activeUsers, daily, selected, users, requests, buckets] = await Promise.all([
      tx.user.count(), tx.user.count({ where: { status: "ACTIVE" } }), stats(tx, { start: today, end: now }), stats(tx, window),
      tx.user.findMany({ select: userSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 4 }),
      tx.apiRequest.findMany({ where: requestsWhere(window, {}), select: requestSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5 }),
      tx.$queryRaw<{ date: string; requests: bigint; tokens: bigint; spend: Prisma.Decimal }[]>(Prisma.sql`SELECT to_char(r."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD') AS date, COUNT(*) AS requests,
        COALESCE(SUM(r."totalTokens"),0)::bigint AS tokens, COALESCE(SUM(r."userCost") FILTER (WHERE r."settledAt" IS NOT NULL),0) AS spend FROM "ApiRequest" r
        WHERE ${requestPredicate(window)} GROUP BY date ORDER BY date`),
    ]);
    const lookup = new Map(buckets.map((row) => [row.date, row]));
    const points = Array.from({ length: Math.ceil((window.end.getTime() - window.start.getTime()) / 86400000) }, (_, i) => {
      const date = new Date(window.start.getTime() + i * 86400000), key = date.toISOString().slice(0, 10), row = lookup.get(key);
      return { date: date.toISOString(), label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date), requests: row?.requests.toString() ?? "0", tokens: row?.tokens.toString() ?? "0", spend: money(row?.spend ?? "0").toFixed(20) };
    });
    return { query, from: window.start.toISOString(), to: window.end.toISOString(), today: daily, selected, totalUsers, activeUsers, points, recentUsers: await usersDto(tx, users), recentRequests: requests.map(requestDto) };
  }, options);
}
