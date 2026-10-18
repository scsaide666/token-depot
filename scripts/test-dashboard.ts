import { riskTestEnvironment } from "./risk-test-environment";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type ApiRequest, type Model, type WalletTransaction } from "../generated/prisma/client";
import { getDb } from "../lib/server/db";
import { hashPassword } from "../lib/server/password";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { reserveRequest, settleFailure, settleSuccess } from "../lib/billing/wallet";
import { formatCny } from "../lib/analytics-format";
import type { BillingData, OverviewData, UsageData, UsageQuery } from "../lib/analytics-types";

config({ quiet: true });
const risk = riskTestEnvironment("dashboard");
Object.assign(process.env, risk.env);
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl || databaseUrl === process.env.DATABASE_URL) throw new Error("An isolated test database is required.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test");
process.env.DATABASE_URL = databaseUrl;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 4 }), log: [] });
const origin = "http://127.0.0.1:3111", seed = randomBytes(8).toString("hex");
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, NODE_ENV: "production" };
type Owner = { id: string; keyIds: string[]; cookie: string; walletId: string };
const owners: Owner[] = [], models: Model[] = [], records: ApiRequest[] = [], ledgers: WalletTransaction[] = [];
let server: ChildProcess | undefined, passed = 0, activeCheck = "startup";
const zero = "0.00000000000000000000", now = new Date(), monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const ago = (days: number) => new Date(now.getTime() - days * 86400000);
function units(value: string) { return BigInt(value.replace(".", "")); }
function fixed(value: bigint) { const negative = value < BigInt(0), digits = (negative ? -value : value).toString().padStart(21, "0"); return `${negative ? "-" : ""}${digits.slice(0, -20)}.${digits.slice(-20)}`; }
function spend(rows: WalletTransaction[]) { return fixed(-rows.reduce((sum, row) => sum + units(row.amount.toFixed(20)), BigInt(0))); }
async function owner(balance: string, role: "USER" | "ADMIN" = "USER"): Promise<Owner> {
  const user = await db.user.create({ data: { name: `Dashboard fixture ${owners.length}`, email: `dashboard-${seed}-${owners.length}@example.test`, passwordHash: await hashPassword(`Fixture-${randomBytes(24).toString("hex")}`), role, wallet: { create: { balance } } }, include: { wallet: true } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), userAgent: "Dashboard integration fixture" } });
  const result = { id: user.id, keyIds: [] as string[], cookie: `__Host-aihub-session=${token}`, walletId: user.wallet!.id }; owners.push(result);
  for (const name of ["Production", "Development"]) {
    const secret = generateApiKey();
    const key = await db.apiKey.create({ data: { userId: user.id, name: `${name}-${owners.length}`, keyHash: secret.keyHash, keyPrefix: secret.keyPrefix } }); result.keyIds.push(key.id);
  }
  return result;
}
async function model(label: string, tiny = false) {
  const m = await db.model.create({ data: { slug: `dashboard-${seed}-${label}`, name: "Dashboard fixture", provider: "OPENAI", providerModel: `private-provider-${seed}-${label}`, description: "Isolated analytics fixture", contextWindow: 100000, inputPricePerMillion: tiny ? "0.00000001" : "1", outputPricePerMillion: tiny ? "0" : "2", markupMultiplier: tiny ? "0.000001" : "1.25", enabled: true } }); models.push(m); return m;
}
async function seedRequest(u: Owner, m: Model, date: Date, status: "SUCCESS" | "FAILED" | "PENDING", index: number, tokenInput = 20, tokenOutput = 10) {
  const requestId = randomUUID();
  await reserveRequest(requestId, { userId: u.id, apiKeyId: u.keyIds[index % 2] }, m, { model: m.slug, messages: [{ role: "user", content: "Hello" }], max_tokens: 100 });
  const usage = { inputTokens: tokenInput, outputTokens: tokenOutput, totalTokens: tokenInput + tokenOutput };
  if (status === "SUCCESS") await settleSuccess(u.id, requestId, usage, 100 + index * 10);
  if (status === "FAILED") await settleFailure(u.id, requestId, "provider_error", 100 + index * 10, index % 2 ? usage : undefined);
  const record = await db.apiRequest.update({ where: { requestId }, data: { createdAt: date } }); records.push(record);
  if (status === "SUCCESS") {
    const entry = await db.walletTransaction.update({ where: { requestId }, data: { createdAt: date } }); ledgers.push(entry);
  }
  return record;
}
function filtered(u: Owner, range: string, filters: Partial<UsageQuery> = {}) {
  const start = ago(range === "24H" ? 1 : range === "7D" ? 7 : 30);
  return records.filter((record) => record.userId === u.id && record.createdAt >= start && (!filters.modelId || record.modelId === filters.modelId) && (!filters.apiKeyId || record.apiKeyId === filters.apiKeyId) && (!filters.status || record.status === filters.status));
}
function expectedStats(rows: ApiRequest[]) {
  const completed = rows.filter((row) => row.status !== "PENDING"), failures = rows.filter((row) => row.status === "FAILED");
  return {
    requests: String(rows.length), tokens: rows.reduce((sum, row) => sum + BigInt(row.totalTokens ?? 0), BigInt(0)).toString(),
    spend: fixed(rows.reduce((sum, row) => sum + units(row.userCost?.toFixed(20) ?? zero), BigInt(0))),
    averageLatencyMs: completed.length ? Math.round(completed.reduce((sum, row) => sum + row.latencyMs, 0) / completed.length) : null,
    errorRate: completed.length ? (failures.length * 100 / completed.length).toFixed(2) : "0.00",
    failedRequests: String(failures.length), pendingRequests: String(rows.length - completed.length),
  };
}
async function response(path: string, u?: Owner, method = "GET") {
  return fetch(origin + path, { method, headers: u ? { Cookie: u.cookie } : {}, redirect: "manual", signal: AbortSignal.timeout(30000) });
}
function privateBoundary(data: unknown) {
  const value = JSON.stringify(data);
  for (const forbidden of ["passwordHash", "tokenHash", "keyHash", "keyPrefix", "providerCost", "inputPricePerMillion", "outputPricePerMillion", "markupMultiplier", "providerModel", "private-provider-", "userId"]) assert(!value.includes(forbidden), "Analytics must exclude private fields.");
}
async function api<T>(path: string, u?: Owner, status = 200): Promise<T> {
  const r = await response(path, u); assert.equal(r.status, status); assert.equal(r.headers.get("cache-control"), "no-store");
  const data = await r.json() as T; privateBoundary(data); return data;
}
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); passed++; console.log(`PASS ${name}`); }

async function main() {
  assert(await fetch(origin, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Test port must be free.");
  try { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" }); } catch { throw new Error("Isolated dashboard migration failed."); }
  const handle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3111"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); server = handle;
  handle.stdout?.on("data", () => {}); handle.stderr?.on("data", () => {}); let startupError = false; handle.on("error", () => { startupError = true; });
  const deadline = Date.now() + 30000;
  while (!await fetch(origin + "/api/auth/session", { signal: AbortSignal.timeout(1000) }).then((r) => r.status === 200).catch(() => false)) { if (startupError || handle.exitCode !== null || Date.now() > deadline) throw new Error("Dashboard server failed to start. Build first."); await new Promise((resolve) => setTimeout(resolve, 100)); }
  const a = await owner("100"), b = await owner("500", "ADMIN"), empty = await owner("0");
  const m1 = await model("first"), m2 = await model("second"), mb = await model("other-user"), tiny = await model("tiny", true);
  for (let i = 0; i < 35; i++) await seedRequest(a, i % 2 ? m2 : m1, ago(0.1), "SUCCESS", i);
  for (let i = 0; i < 5; i++) await seedRequest(a, m1, ago(0.2), "FAILED", i);
  await seedRequest(a, m1, ago(0.05), "PENDING", 0);
  for (const date of [ago(2), ago(10), ago(40), monthStart, new Date(monthStart.getTime() - 1)]) await seedRequest(a, m2, date, "SUCCESS", 0);
  await seedRequest(a, tiny, ago(0.1), "SUCCESS", 0, 1, 0);
  // Pre-billing history must remain unbilled and display unknown costs as NULL.
  records.push(await db.apiRequest.create({ data: { requestId: randomUUID(), userId: a.id, apiKeyId: a.keyIds[0], modelId: m1.id, provider: "OPENAI", status: "SUCCESS", latencyMs: 123, inputTokens: 40, outputTokens: 2, totalTokens: 42, createdAt: ago(0.3) } }));
  await seedRequest(b, mb, ago(0.1), "SUCCESS", 0, 200, 100);
  const paths = ["/api/dashboard/overview", "/api/dashboard/usage", "/api/dashboard/billing"];
  await check("Analytics APIs require a current ACTIVE session", async () => {
    for (const path of paths) { await api(path, undefined, 401); await api(path, { ...a, cookie: "__Host-aihub-session=invalid" }, 401); }
    await db.user.update({ where: { id: empty.id }, data: { status: "SUSPENDED" } });
    for (const path of paths) await api(path, empty, 401);
    await db.user.update({ where: { id: empty.id }, data: { status: "ACTIVE" } });
  });
  await check("Empty accounts return true zero metrics and bounded empty pages", async () => {
    const overview = await api<OverviewData>(paths[0], empty), usage = await api<UsageData>(paths[1], empty), billing = await api<BillingData>(paths[2], empty);
    assert.equal(overview.availableBalance, zero); assert.equal(overview.recentRequests.length, 0); assert.equal(overview.month.requests, "0");
    assert.deepEqual(usage.stats, expectedStats([])); assert.equal(usage.requests.length, 0); assert.equal(usage.pagination.total, 0); assert.equal(usage.pagination.page, 1); assert.equal(usage.filters.models.length, 0);
    assert.equal(billing.monthSpend, zero); assert.equal(billing.lifetimeSpend, zero); assert.equal(billing.transactions.length, 0);
  });
  await check("Overview uses real available balance, UTC month aggregates and settled ledger spending", async () => {
    const value = await api<OverviewData>(paths[0], a), wallet = await db.wallet.findUniqueOrThrow({ where: { userId: a.id } });
    assert.equal(value.availableBalance, fixed(units(wallet.balance.toFixed(20)) - units(wallet.reservedBalance.toFixed(20)))); assert.equal(value.reservedBalance, wallet.reservedBalance.toFixed(20));
    assert.deepEqual(value.month, expectedStats(records.filter((r) => r.userId === a.id && r.createdAt >= monthStart)));
    assert.equal(value.monthSpend, spend(ledgers.filter((r) => r.walletId === a.walletId && r.createdAt >= monthStart))); assert(value.reservedBalance !== zero);
    assert.equal(value.recentRequests.length, 5); assert(!JSON.stringify(value).includes(mb.slug));
  });
  await check("24H, 7D and 30D charts reconcile database token, request and Decimal spend aggregates", async () => {
    for (const [range, buckets] of [["24H", 24], ["7D", 7], ["30D", 30]] as const) {
      const value = await api<UsageData>(`${paths[1]}?range=${range}`, a); assert.deepEqual(value.stats, expectedStats(filtered(a, range))); assert.equal(value.points.length, buckets);
      assert.equal(value.points.reduce((sum, p) => sum + BigInt(p.requests), BigInt(0)).toString(), value.stats.requests);
      assert.equal(value.points.reduce((sum, p) => sum + BigInt(p.tokens), BigInt(0)).toString(), value.stats.tokens);
      assert.equal(fixed(value.points.reduce((sum, p) => sum + units(p.spend), BigInt(0))), value.stats.spend);
      const overview = await api<OverviewData>(`${paths[0]}?range=${range}`, a); assert.equal(overview.points.length, buckets);
    }
  });
  await check("Model, API key and status filters affect stats, chart and server-paginated history together", async () => {
    for (const filters of [{ modelId: m1.id }, { apiKeyId: a.keyIds[1] }, { status: "FAILED" as const }, { status: "PENDING" as const }, { modelId: m1.id, apiKeyId: a.keyIds[0], status: "SUCCESS" as const }]) {
      const params = new URLSearchParams({ range: "7D" });
      for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key, value);
      const value = await api<UsageData>(`${paths[1]}?${params}`, a), rows = filtered(a, "7D", filters);
      assert.deepEqual(value.stats, expectedStats(rows)); assert.equal(value.pagination.total, rows.length); assert(value.requests.every((r) => rows.some((row) => row.id === r.id)));
      assert.equal(value.points.reduce((sum, p) => sum + BigInt(p.requests), BigInt(0)).toString(), String(rows.length));
    }
  });
  await check("Request history has stable server pages with a timestamp tie-breaker and bounded page size", async () => {
    const expected = filtered(a, "30D").sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || (left.id < right.id ? 1 : -1));
    const ids: string[] = [];
    for (let page = 1; page <= Math.ceil(expected.length / 10); page++) { const value = await api<UsageData>(`${paths[1]}?range=30D&page=${page}&pageSize=10`, a); assert(value.requests.length <= 10); assert.equal(value.pagination.total, expected.length); ids.push(...value.requests.map((r) => r.id)); }
    assert.deepEqual(ids, expected.map((r) => r.id)); assert.equal(new Set(ids).size, ids.length);
    const clamped = await api<UsageData>(`${paths[1]}?range=30D&page=99999`, a); assert.equal(clamped.pagination.page, clamped.pagination.totalPages);
  });
  await check("Billing reconciles available/reserved balance, UTC monthly spend and lifetime USAGE ledger", async () => {
    const value = await api<BillingData>(paths[2], a), wallet = await db.wallet.findUniqueOrThrow({ where: { userId: a.id } }), ownLedger = ledgers.filter((r) => r.walletId === a.walletId);
    assert.equal(value.availableBalance, fixed(units(wallet.balance.toFixed(20)) - units(wallet.reservedBalance.toFixed(20)))); assert.equal(value.reservedBalance, wallet.reservedBalance.toFixed(20)); assert.equal(value.monthSpend, spend(ownLedger.filter((r) => r.createdAt >= monthStart))); assert.equal(value.lifetimeSpend, spend(ownLedger));
    assert(value.transactions.length <= 25); assert.equal(value.pagination.total, ownLedger.length);
    const page2 = await api<BillingData>(paths[2] + "?page=2", a); assert(!value.transactions.some((r) => page2.transactions.some((row) => row.id === r.id)));
    for (const row of [...value.transactions, ...page2.transactions]) { const original = ownLedger.find((r) => r.id === row.id); assert(original); assert.equal(row.amount, original.amount.toFixed(20)); assert.equal(row.balanceAfter, original.balanceAfter.toFixed(20)); assert.equal(row.description, original.description); }
  });
  await check("Tiny one-token charges retain 20 fractional places; historical costs and unknown usage stay NULL", async () => {
    const value = await api<UsageData>(paths[1] + `?modelId=${tiny.id}`, a); assert.equal(value.stats.spend, "0.00000000000000000001"); assert.equal(value.requests[0].cost, value.stats.spend); assert.equal(formatCny(value.stats.spend), "¥0.00000000000000000001");
    const legacy = records.find((r) => r.userId === a.id && r.status === "SUCCESS" && r.userCost === null)!;
    const requests = await api<UsageData>(paths[1] + "?pageSize=50", a); assert.equal(requests.requests.find((r) => r.id === legacy.id)?.cost, null); assert(requests.requests.some((r) => r.status === "FAILED" && r.inputTokens === null));
  });
  await check("Other-user model/key parameters never expose another user's data, including ADMIN sessions", async () => {
    for (const filters of [`modelId=${mb.id}`, `apiKeyId=${b.keyIds[0]}`, `modelId=${mb.id}&apiKeyId=${b.keyIds[0]}`]) { const value = await api<UsageData>(paths[1] + "?" + filters, a); assert.equal(value.stats.requests, "0"); assert.equal(value.requests.length, 0); assert(!JSON.stringify(value).includes(mb.slug)); assert(!value.filters.apiKeys.some((k) => b.keyIds.includes(k.value))); }
    const other = await api<UsageData>(paths[1], b); assert.deepEqual(other.stats, expectedStats(filtered(b, "7D"))); assert(!JSON.stringify(other).includes(m1.slug)); assert(other.requests.every((r) => records.some((record) => record.id === r.id && record.userId === b.id)));
    const bills = await api<BillingData>(paths[2], b); assert(bills.transactions.every((r) => ledgers.some((entry) => entry.id === r.id && entry.walletId === b.walletId)));
  });
  await check("Strict filters reject ownership overrides, malformed/injected IDs, duplicates and oversized pagination", async () => {
    for (const path of paths) { await api(path + `?userId=${b.id}`, a, 400); await api(path + "?walletId=" + b.walletId, a, 400); assert.equal((await response(path, a, "POST")).status, 405); }
    const invalidQueries = ["range=ALL", "page=0", "page=-1", "page=1.2", "page=100001", "pageSize=10000", "status=UNKNOWN", "modelId=x%27%20OR%201=1", "apiKeyId=invalid", "range=7D&range=24H", "constructor=x", "modelId=" + "x".repeat(1500)];
    for (let index = 0; index < invalidQueries.length; index++) {
      activeCheck = `Strict filter case ${index}`;
      await api(paths[1] + "?" + invalidQueries[index], a, 400);
    }
    // Next's URL query conversion removes __proto__ before the Route Handler.
    // That normalization must still leave the result scoped to the signed-in owner.
    const normalized = await api<UsageData>(paths[1] + "?__proto__=x", a);
    assert.deepEqual(normalized.stats, expectedStats(filtered(a, "7D")));
    assert(!JSON.stringify(normalized).includes(mb.slug));
  });
  await check("Deleted key/model references retain owned history, slug snapshots and finalized fees", async () => {
    const deleted = await model("deleted"), record = await seedRequest(a, deleted, ago(0.1), "SUCCESS", 1);
    await db.apiKey.delete({ where: { id: a.keyIds[1] } }); await db.model.delete({ where: { id: deleted.id } });
    const value = await api<UsageData>(paths[1] + "?pageSize=50", a), row = value.requests.find((r) => r.id === record.id); assert(row); assert.equal(row.model, deleted.slug); assert.equal(row.cost, record.userCost?.toFixed(20)); assert.equal(row.apiKeyName, "Deleted or unavailable key");
    assert(!value.filters.apiKeys.some((option) => option.value === a.keyIds[1])); assert(!value.filters.models.some((option) => option.value === deleted.id));
  });
  await check("Server-rendered Dashboard, Usage and Billing contain real owned data with no other-user content", async () => {
    for (const path of ["/dashboard", "/dashboard/usage?pageSize=10", "/dashboard/billing"]) {
      const r = await response(path, a); assert.equal(r.status, 200); const body = await r.text();
      // Quick Start lists enabled public models, regardless of who has used them.
      // Owned activity must stay isolated; public model metadata is not private history.
      const ownedActivity = path === "/dashboard" ? body.match(/<section aria-labelledby="dashboard-recent-heading"[\s\S]*?<\/section>/)?.[0] : body;
      assert(ownedActivity, "Owned request history must be rendered"); assert(!ownedActivity.includes(mb.slug));
      if (path === "/dashboard") { assert(body.includes("Quick Start")); assert(body.includes(mb.slug), "Enabled public models are available in Quick Start"); }
      assert(!body.includes("private-provider-")); assert(!body.includes("passwordHash")); assert(!body.includes("keyHash")); assert(!body.includes("Demo data")); assert(!body.includes("Unable to load data")); assert(body.includes(path === "/dashboard/billing" ? "Balance After" : "Input Tokens"));
    }
    for (const path of ["/dashboard/usage", "/dashboard/billing"]) { const body = await (await response(path, empty)).text(); assert(body.includes(path.endsWith("usage") ? "No requests yet" : "No transactions yet")); }
    const invalid = await (await response(`/dashboard/usage?userId=${b.id}`, a)).text(); assert(invalid.includes("Clear filters")); assert(!invalid.includes(mb.slug));
  });
  await check("12,000 request rows are aggregated in PostgreSQL and only a bounded history page reaches the client", async () => {
    const large = await owner("0"), bulkModel = await model("large");
    for (let batch = 0; batch < 12; batch++) await db.apiRequest.createMany({ data: Array.from({ length: 1000 }, () => ({ requestId: randomUUID(), userId: large.id, apiKeyId: large.keyIds[0], modelId: bulkModel.id, status: "SUCCESS" as const, latencyMs: 123, inputTokens: 1, outputTokens: 1, totalTokens: 2, createdAt: ago(0.1) })) });
    const value = await api<UsageData>(paths[1], large); assert.equal(value.stats.requests, "12000"); assert.equal(value.stats.tokens, "24000"); assert.equal(value.stats.spend, zero); assert.equal(value.requests.length, 25); assert.equal(value.pagination.totalPages, 480); assert(JSON.stringify(value).length < 30000);
    const indexes = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename IN ('ApiRequest','WalletTransaction')`;
    for (const name of ["ApiRequest_userId_createdAt_id_idx", "ApiRequest_userId_status_createdAt_id_idx", "ApiRequest_userId_modelId_createdAt_id_idx", "ApiRequest_userId_apiKeyId_createdAt_id_idx", "WalletTransaction_walletId_createdAt_id_idx"]) assert(indexes.some((index) => index.indexname === name));
  });
  console.log(`Dashboard integration checks: ${passed} passed (isolated PostgreSQL; no payment or live provider).`);
}
async function run() {
  try { await main(); } catch (error) {
    console.error(`FAIL ${activeCheck}. No credentials or raw response contents were printed.`);
    if (error instanceof assert.AssertionError) {
      const numeric = (value: unknown) => typeof value === "number" ? value : "[non-numeric assertion]";
      console.error(`Assertion: actual=${numeric(error.actual)}, expected=${numeric(error.expected)}`);
    }
    else if (error && typeof error === "object" && "code" in error && /^P\d{4}$/.test(String(error.code))) console.error(`Database error: ${error.code}`);
    else if (error instanceof Error) console.error(`Error class: ${error.constructor.name}`);
    process.exitCode = 1;
  } finally {
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    await db.user.deleteMany({ where: { id: { in: owners.map((u) => u.id) }, email: { startsWith: `dashboard-${seed}-` } } }).catch(() => { console.error("Dashboard fixture cleanup failed."); process.exitCode = 1; });
    await db.model.deleteMany({ where: { id: { in: models.map((m) => m.id) } } }).catch(() => { console.error("Dashboard model cleanup failed."); process.exitCode = 1; });
    await risk.cleanup();
    await db.$disconnect(); await getDb().$disconnect();
  }
}
void run().catch(() => { console.error("Dashboard cleanup failed."); process.exitCode = 1; });
