import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type ApiRequest, type Model, type PaymentOrder } from "../generated/prisma/client";
import { getDb } from "../lib/server/db";
import { hashPassword } from "../lib/server/password";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { reserveRequest, settleFailure, settleSuccess } from "../lib/billing/wallet";
import { applyVerifiedPayment } from "../lib/payments/orders";
import { verifiedReceipt } from "../lib/payments/providers/types";
import { riskTestEnvironment } from "./risk-test-environment";
import type { AdminUsersData, AdminOverviewData, AdminRequestsData, AdminPaymentsData, AdminModelsData, AdminUserRecord, FinancialStats } from "../lib/admin-types";
import type { BillingData } from "../lib/analytics-types";

config({ quiet: true });
const risk = riskTestEnvironment("admin");
Object.assign(process.env, risk.env);
const databaseUrl = process.env.DATABASE_URL_TEST;
assert(databaseUrl && databaseUrl !== process.env.DATABASE_URL, "Use the isolated test database.");
const location = new URL(databaseUrl);
assert(["localhost", "127.0.0.1"].includes(location.hostname) && location.pathname === "/aihub_auth_test");
process.env.DATABASE_URL = databaseUrl;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 5 }), log: [] });
const origins = [3130, 3131].map((port) => `http://127.0.0.1:${port}`), children: ChildProcess[] = [];
const seed = randomBytes(8).toString("hex"), owners: Owner[] = [], models: Model[] = [], records: ApiRequest[] = [], orders: PaymentOrder[] = [];
type Owner = { id: string; name: string; email: string; walletId: string; cookie: string; keyId: string; key: string };
let passed = 0, activeCheck = "startup";
function units(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole + fraction.padEnd(20, "0")); }
function fixed(value: bigint) { const sign = value < BigInt(0) ? "-" : "", digits = (value < BigInt(0) ? -value : value).toString().padStart(21, "0"); return `${sign}${digits.slice(0, -20)}.${digits.slice(-20)}`; }
function boundary(value: unknown) {
  const text = JSON.stringify(value);
  for (const field of ["passwordHash", "tokenHash", "keyHash", "apiKey", "messages", "prompt", "response", "merchantId", "appId", "providerTransactionId", "idempotencyKey", "codeUrl", "qrCodeDataUrl", "privateKey", "signature"]) assert(!text.includes(`"${field}"`), `Admin response includes private field: ${field}`);
  for (const owner of owners) assert(!text.includes(owner.key) && !text.includes(owner.cookie.split("=")[1]));
}
async function session(id: string) {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), userAgent: "Admin integration fixture" } });
  return `__Host-aihub-session=${token}`;
}
async function owner(name: string, balance = "100", role: "USER" | "ADMIN" = "USER") {
  const user = await db.user.create({ data: { name, email: `admin-${seed}-${owners.length}@example.test`, role, passwordHash: await hashPassword(randomBytes(32).toString("hex")), wallet: { create: { balance } } }, include: { wallet: true } });
  const secret = generateApiKey(), key = await db.apiKey.create({ data: { userId: user.id, name: "Integration", keyHash: secret.keyHash, keyPrefix: secret.keyPrefix } });
  const value = { id: user.id, name: user.name, email: user.email, walletId: user.wallet!.id, cookie: await session(user.id), keyId: key.id, key: secret.key };
  owners.push(value); return value;
}
async function model(label: string, tiny = false) {
  const value = await db.model.create({ data: { name: `Admin model ${label}`, slug: `admin-${seed}-${label}`, provider: "OPENAI", providerModel: `internal-${seed}-${label}`, description: "Isolated admin fixture", contextWindow: 100000, inputPricePerMillion: tiny ? "0.00000001" : "2", outputPricePerMillion: tiny ? "0" : "3", markupMultiplier: tiny ? "0.000001" : "1.25", enabled: true } });
  models.push(value); return value;
}
async function seedRequest(u: Owner, m: Model, date: Date, status: "SUCCESS" | "FAILED" | "PENDING", input = 20, output = 10, knownFailure = true) {
  const requestId = randomUUID(), usage = { inputTokens: input, outputTokens: output, totalTokens: input + output };
  await reserveRequest(requestId, { userId: u.id, apiKeyId: u.keyId }, m, { model: m.slug, messages: [{ role: "user", content: "Test" }], max_tokens: 100 });
  if (status === "SUCCESS") await settleSuccess(u.id, requestId, usage, 720);
  if (status === "FAILED") await settleFailure(u.id, requestId, "provider_error", 840, knownFailure ? usage : undefined);
  const row = await db.apiRequest.update({ where: { requestId }, data: { createdAt: date } }); records.push(row);
  if (status === "SUCCESS") await db.walletTransaction.update({ where: { requestId }, data: { createdAt: date } });
  return row;
}
async function payment(u: Owner, method: "ALIPAY" | "WECHAT", date: Date, status: "PENDING" | "PAID" | "FAILED" | "CLOSED" = "PENDING") {
  let row = await db.paymentOrder.create({ data: { userId: u.id, orderNo: `AH${randomBytes(14).toString("hex")}`, idempotencyKey: randomUUID(), method, amount: "50.00", appId: "test-only-app", merchantId: "test-only-merchant", expiresAt: new Date(Date.now() + 300000), createdAt: date } });
  if (status === "PAID") row = await applyVerifiedPayment(verifiedReceipt({ method, merchantId: row.merchantId, appId: row.appId, orderNo: row.orderNo, amount: row.amount.toFixed(2), currency: "CNY", status, transactionId: randomUUID(), paidAt: date }));
  else if (status !== "PENDING") row = await db.paymentOrder.update({ where: { id: row.id }, data: { status, ...(status === "CLOSED" ? { closedAt: date } : {}) } });
  orders.push(row); return row;
}
function expected(rows: ApiRequest[]): FinancialStats {
  const revenue = rows.filter((r) => r.settledAt && r.userCost).reduce((sum, r) => sum + units(r.userCost!.toFixed(20)), BigInt(0));
  const providerCost = rows.filter((r) => r.settledAt && r.providerCost).reduce((sum, r) => sum + units(r.providerCost!.toFixed(20)), BigInt(0));
  return { requests: String(rows.length), tokens: rows.reduce((sum, r) => sum + BigInt(r.totalTokens ?? 0), BigInt(0)).toString(), revenue: fixed(revenue), providerCost: fixed(providerCost), profit: fixed(revenue - providerCost), unknownCosts: String(rows.filter((r) => r.status !== "PENDING" && (r.providerCost === null || r.userCost === null)).length) };
}
async function response(path: string, u?: Owner, options: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: string; worker?: number } = {}) {
  const origin = origins[options.worker ?? 0], method = options.method ?? "GET";
  return fetch(origin + path, { method, redirect: "manual", headers: { ...(u ? { Cookie: u.cookie } : {}), ...(method === "POST" || method === "PATCH" ? { Origin: origin, "Content-Type": "application/json" } : {}), ...options.headers }, ...(options.body !== undefined || options.raw !== undefined ? { body: options.raw ?? JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(30000) });
}
async function api<T = Record<string, unknown>>(path: string, u?: Owner, status = 200, options: Parameters<typeof response>[2] = {}): Promise<T> {
  const result = await response(path, u, options); assert.equal(result.status, status); assert.equal(result.headers.get("cache-control"), "no-store"); const value = await result.json(); boundary(value); return value as T;
}
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); passed++; console.log(`PASS ${name}`); }
function adjustment(amount: string, direction: "ADD" | "DEDUCT" = "ADD", reason = "Integration adjustment", adjustmentId = randomUUID()) { return { amount, direction, reason, adjustmentId }; }
async function wallet(u: Owner) { return db.wallet.findUniqueOrThrow({ where: { userId: u.id } }); }
async function start() {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", DEEPSEEK_API_KEY: "", ALIPAY_APP_ID: "", WECHAT_MCH_ID: "" };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" });
  for (const origin of origins) {
    assert(await fetch(origin, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Test port must be free.");
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", new URL(origin).port], { env: { ...env, APP_ORIGIN: origin }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child); child.stdout?.on("data", () => {}); child.stderr?.on("data", () => {}); let startupError = false; child.on("error", () => { startupError = true; });
    const deadline = Date.now() + 30000;
    while (!await fetch(origin + "/api/auth/session", { signal: AbortSignal.timeout(1000) }).then((r) => r.status === 200).catch(() => false)) { assert(!startupError && child.exitCode === null && Date.now() < deadline, "Build first; test server did not start."); await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
}
async function main() {
  await start();
  const admin = await owner(`Admin ${seed}`, "0", "ADMIN"), secondary = await owner(`Second admin ${seed}`, "0", "ADMIN"), a = await owner(`Search target ${seed}`), b = await owner(`Other owner ${seed}`), empty = await owner(`Empty ${seed}`, "0");
  const m1 = await model("first"), m2 = await model("second"), tiny = await model("tiny", true);
  const recent = new Date(Date.now() - 2000), jan10 = new Date("2026-01-10T12:00:00Z"), jan11 = new Date("2026-01-11T00:00:00Z"), jan12 = new Date("2026-01-12T00:00:00Z");
  for (let i = 0; i < 31; i++) await seedRequest(a, i % 2 ? m2 : m1, recent, "SUCCESS", i + 1, 10);
  await seedRequest(a, m1, recent, "FAILED"); await seedRequest(a, m2, recent, "FAILED", 0, 0, false); await seedRequest(a, tiny, recent, "SUCCESS", 1, 0); await seedRequest(a, m1, recent, "PENDING");
  await seedRequest(a, m1, jan10, "SUCCESS"); await seedRequest(b, m2, jan11, "SUCCESS"); await seedRequest(a, m2, jan12, "FAILED");
  records.push(await db.apiRequest.create({ data: { userId: a.id, apiKeyId: a.keyId, modelId: m1.id, provider: "OPENAI", requestId: randomUUID(), status: "SUCCESS", latencyMs: 123, inputTokens: 40, outputTokens: 2, totalTokens: 42, createdAt: recent } }));
  await payment(a, "ALIPAY", recent, "PAID"); await payment(b, "WECHAT", recent, "PAID");
  await payment(a, "ALIPAY", jan10); await payment(b, "WECHAT", jan11, "CLOSED"); await payment(b, "WECHAT", jan12, "FAILED");
  for (let i = 0; i < 31; i++) await payment(a, i % 2 ? "ALIPAY" : "WECHAT", recent);
  const paths = ["/api/admin/overview", "/api/admin/users", "/api/admin/requests", "/api/admin/payments", "/api/admin/models"];
  const pages = ["/admin", "/admin/users", "/admin/models", "/admin/requests", "/admin/payments"];
  await check("Every Admin API and HTML/RSC/prefetch/HEAD page requires a current ADMIN", async () => {
    for (const path of paths) { await api(path, undefined, 401); await api(path, a, 403); }
    for (const path of [`/api/admin/users/${b.id}`, `/api/admin/users/${b.id}/balance`]) {
      await api(path, a, 403, { method: path.endsWith("balance") ? "POST" : "PATCH", body: path.endsWith("balance") ? adjustment("1.00") : { status: "SUSPENDED" } });
    }
    await api(`/api/admin/users/${b.id}`, a, 403);
    const headerCases: Record<string, string>[] = [{}, { RSC: "1" }, { RSC: "1", "Next-Router-Prefetch": "1" }, { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy", "x-user-role": "ADMIN", "x-user-id": admin.id }];
    for (const path of pages) for (const headers of headerCases) {
      const r = await response(path, a, { headers }); assert.equal(r.status, 403); const body = await r.text(); assert(body.includes("Administrator access is required.")); assert(!body.includes(b.email) && !body.includes(m1.providerModel));
    }
    assert.equal((await response("/admin/users", a, { method: "HEAD" })).status, 403);
    assert.equal((await response("/admin")).status, 307);
  });
  await check("Role removal, expiry and suspension are rechecked across both server processes", async () => {
    await db.user.update({ where: { id: secondary.id }, data: { role: "USER" } }); await api(paths[0], secondary, 403, { worker: 1 }); assert.equal((await response("/admin", secondary)).status, 403);
    await db.user.update({ where: { id: secondary.id }, data: { role: "ADMIN", status: "SUSPENDED" } }); await api(paths[0], secondary, 401);
    await db.user.update({ where: { id: secondary.id }, data: { status: "ACTIVE" } });
    await db.session.updateMany({ where: { userId: secondary.id }, data: { expiresAt: new Date(Date.now() - 1000) } }); await api(paths[0], secondary, 401); secondary.cookie = await session(secondary.id);
    await api(paths[0], secondary, 200, { worker: 1 });
  });
  await check("Strict filters reject injected identities, duplicate keys and invalid date/paging ranges", async () => {
    for (const [path, suffix] of [[paths[0], "?from=2026-02-30"], [paths[0], "?from=2025-01-01&to=2026-10-01"], [paths[0], "?from=2026-01-12&to=2026-01-10"], [paths[0], "?from=2099-01-01"],
      [paths[1], "?page=0"], [paths[1], "?pageSize=10000"], [paths[1], "?page=1&page=2"], [paths[1], "?role=ADMIN"], [paths[2], "?userId=bad"], [paths[2], "?status=PAID"], [paths[3], "?method=STRIPE"], [paths[4], "?provider=UNKNOWN"]]) await api(path + suffix, admin, 400);
    await api(paths[1] + "?search=" + "x".repeat(2000), admin, 400);
  });
  await check("Dashboard uses database counts, known token usage and exact settled CNY profit", async () => {
    const value = await api<AdminOverviewData>(paths[0], admin), now = new Date(), today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    assert.equal(value.totalUsers, await db.user.count()); assert.equal(value.activeUsers, await db.user.count({ where: { status: "ACTIVE" } }));
    assert.deepEqual(value.today, expected(records.filter((r) => r.createdAt >= today)));
    assert.equal(value.points.length, 7); assert(value.recentUsers.length <= 4 && value.recentRequests.length <= 5); assert(value.today.unknownCosts !== "0");
    assert.notEqual(value.today.revenue, "100.00000000000000000000", "Top ups cannot count as API revenue.");
    const row = await api<AdminRequestsData>(paths[2] + `?modelId=${tiny.id}`, admin); assert.equal(row.stats.revenue, "0.00000000000000000001"); assert.equal(row.requests[0].profit, "-0.00000000000000999999");
  });
  await check("UTC inclusive end dates and different ranges share precise chart and period totals", async () => {
    const timezones = await Promise.all([db.$queryRaw<{ TimeZone: string }[]>`SHOW TIMEZONE`, getDb().$queryRaw<{ TimeZone: string }[]>`SHOW TIMEZONE`]);
    assert(timezones.every((rows) => rows[0].TimeZone === "UTC"));
    for (const [from, to] of [["2026-01-10", "2026-01-10"], ["2026-01-10", "2026-01-11"], ["2026-01-11", "2026-01-12"]]) {
      const value = await api<AdminOverviewData>(paths[0] + `?from=${from}&to=${to}`, admin);
      const rows = records.filter((r) => r.createdAt >= new Date(from) && r.createdAt < new Date(new Date(to).getTime() + 86400000)); assert.deepEqual(value.selected, expected(rows));
      const chartRequests = value.points.reduce((sum, point) => sum + BigInt(point.requests), BigInt(0)).toString();
      assert.equal(chartRequests, value.selected.requests);
      assert.equal(fixed(value.points.reduce((sum, point) => sum + units(point.spend), BigInt(0))), value.selected.revenue);
    }
    const value = await api<AdminOverviewData>(paths[0] + "?from=2026-01-12&to=2026-01-12", admin); assert(value.selected.profit.startsWith("-"), "Known upstream costs of failed calls must reduce profit.");
  });
  await check("User search is case insensitive, literal and server paginated", async () => {
    const value = await api<AdminUsersData>(paths[1] + `?search=${encodeURIComponent(a.name.toUpperCase())}`, admin); assert.equal(value.users.length, 1); assert.equal(value.users[0].id, a.id);
    for (const search of ["%", "_", "\\", "' OR 1=1 --"]) { const result = await api<AdminUsersData>(paths[1] + "?search=" + encodeURIComponent(search), admin); assert.equal(result.pagination.total, 0); }
    const empty = await api<AdminUsersData>(paths[1] + `?search=missing-${seed}&page=999`, admin); assert.equal(empty.pagination.page, 1); assert.equal(empty.users.length, 0);
  });
  await check("View User exposes real owned wallet/ledger usage aggregates without auth secrets", async () => {
    const value = (await api<{ user: AdminUserRecord }>(`/api/admin/users/${a.id}`, admin)).user, stored = await wallet(a);
    assert.equal(value.balance, stored.balance.toFixed(20)); assert.equal(value.availableBalance, fixed(units(stored.balance.toFixed(20)) - units(stored.reservedBalance.toFixed(20))));
    assert.equal(value.requests, String(records.filter((r) => r.userId === a.id).length));
    const usage = await db.walletTransaction.aggregate({ where: { walletId: a.walletId, type: "USAGE" }, _sum: { amount: true } }); assert.equal(value.lifetimeSpend, fixed(-units(usage._sum.amount!.toFixed(20))));
    await api(`/api/admin/users/${randomUUID()}`, admin, 404); await api("/api/admin/users/bad", admin, 400);
  });
  await check("Suspend invalidates all sessions and API access; Unsuspend requires a new login", async () => {
    await session(b.id);
    await api(`/api/admin/users/${b.id}`, admin, 200, { method: "PATCH", body: { status: "SUSPENDED" } }); assert.equal(await db.session.count({ where: { userId: b.id } }), 0);
    assert.equal((await response("/dashboard", b)).headers.get("location"), "/login");
    const gateway = await response("/v1/chat/completions", undefined, { method: "POST", body: { model: m1.slug, messages: [{ role: "user", content: "Not sent upstream" }] }, headers: { Authorization: `Bearer ${b.key}` } }); assert.equal(gateway.status, 403); assert.equal((await gateway.json()).error.code, "account_suspended");
    const list = await api<AdminUsersData>(paths[1] + "?status=SUSPENDED", admin); assert(list.users.some((u) => u.id === b.id));
    await api(`/api/admin/users/${b.id}`, admin, 200, { method: "PATCH", body: { status: "ACTIVE" } }); assert.equal(await db.session.count({ where: { userId: b.id } }), 0); b.cookie = await session(b.id);
    await api(`/api/admin/users/${admin.id}`, admin, 409, { method: "PATCH", body: { status: "SUSPENDED" } });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).status, "ACTIVE");
  });
  await check("Admin mutations reject CSRF, malformed JSON, floats and forged actor fields", async () => {
    const path = `/api/admin/users/${a.id}/balance`, before = await wallet(a), base = adjustment("1.00");
    for (const changes of [{ amount: 1 }, { amount: "-1" }, { amount: "0" }, { amount: "1.001" }, { amount: "1e3" }, { amount: "1000001" }, { reason: "" }, { reason: "aa" }, { reason: "x".repeat(201) }, { adminId: secondary.id }, { userId: b.id }, { adjustmentId: "bad" }]) await api(path, admin, 422, { method: "POST", body: { ...base, ...changes } });
    await api(path, admin, 403, { method: "POST", body: base, headers: { Origin: "https://foreign.example" } }); await api(path, admin, 403, { method: "POST", body: base, headers: { "Sec-Fetch-Site": "cross-site" } });
    await api(path, admin, 400, { method: "POST", raw: "{" }); await api(path, admin, 415, { method: "POST", body: base, headers: { "Content-Type": "text/plain" } });
    await api(path, admin, 413, { method: "POST", body: { ...base, reason: "x".repeat(9000) } });
    assert.equal((await wallet(a)).balance.toFixed(20), before.balance.toFixed(20));
    await api(`/api/admin/users/${a.id}`, admin, 422, { method: "PATCH", body: { status: "ACTIVE", role: "ADMIN" } });
  });
  await check("Balance adjustment writes exact Decimal money plus admin, reason and before/after audit", async () => {
    const before = await wallet(a), body = adjustment("0.01", "ADD", "  Support credit  ");
    const result = await api<{ transaction: { id: string; balanceAfter: string } }>(`/api/admin/users/${a.id}/balance`, admin, 201, { method: "POST", body });
    const entry = await db.walletTransaction.findUniqueOrThrow({ where: { id: result.transaction.id } }); assert.equal(entry.type, "ADMIN_ADJUSTMENT"); assert.equal(entry.adminId, admin.id); assert.equal(entry.reason, "Support credit"); assert.equal(entry.amount.toFixed(20), "0.01000000000000000000"); assert.equal(entry.balanceBefore.toFixed(20), before.balance.toFixed(20));
    assert.equal(result.transaction.balanceAfter, fixed(units(before.balance.toFixed(20)) + units("0.01"))); assert.equal((await wallet(a)).reservedBalance.toFixed(20), before.reservedBalance.toFixed(20));
    const billing = await api<BillingData>("/api/dashboard/billing", a); assert(billing.transactions.some((row) => row.id === entry.id && row.type === "ADMIN_ADJUSTMENT"));
    const view = (await api<{ user: AdminUserRecord }>(`/api/admin/users/${a.id}`, admin)).user; assert.equal(view.lifetimeSpend, fixed(-units((await db.walletTransaction.aggregate({ where: { walletId: a.walletId, type: "USAGE" }, _sum: { amount: true } }))._sum.amount!.toFixed(20))));
  });
  await check("Ten simultaneous retries across two servers create one immutable adjustment", async () => {
    const body = adjustment("2.35"), before = await wallet(a), path = `/api/admin/users/${a.id}/balance`;
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => api<{ transaction: { id: string } }>(path, admin, 201, { method: "POST", body, worker: i % 2 })));
    assert.equal(new Set(results.map((r) => r.transaction.id)).size, 1); assert.equal((await wallet(a)).balance.toFixed(20), fixed(units(before.balance.toFixed(20)) + units("2.35"))); assert.equal(await db.walletTransaction.count({ where: { adminId: admin.id, adjustmentId: body.adjustmentId } }), 1);
    await api(path, admin, 409, { method: "POST", body: { ...body, amount: "3.00" } }); await api(`/api/admin/users/${b.id}/balance`, admin, 409, { method: "POST", body });
  });
  await check("Deductions respect reserved funds and cannot produce a negative available balance", async () => {
    const held = await owner(`Reserved ${seed}`, "1");
    await db.wallet.update({ where: { userId: held.id }, data: { reservedBalance: "0.90" } });
    await api(`/api/admin/users/${held.id}/balance`, admin, 409, { method: "POST", body: adjustment("0.11", "DEDUCT") });
    assert.equal((await wallet(held)).balance.toFixed(20), "1.00000000000000000000");
    await api(`/api/admin/users/${held.id}/balance`, admin, 201, { method: "POST", body: adjustment("0.10", "DEDUCT") });
    assert.equal((await wallet(held)).balance.toFixed(20), (await wallet(held)).reservedBalance.toFixed(20));
    const before = await wallet(a), path = `/api/admin/users/${a.id}/balance`, count = await db.walletTransaction.count({ where: { walletId: a.walletId } });
    await api(path, admin, 409, { method: "POST", body: adjustment(before.balance.toFixed(2), "DEDUCT") }); assert.equal((await wallet(a)).balance.toFixed(20), before.balance.toFixed(20)); assert.equal(await db.walletTransaction.count({ where: { walletId: a.walletId } }), count);
    await api(path, admin, 201, { method: "POST", body: adjustment("0.01", "DEDUCT") }); assert.equal((await wallet(a)).balance.toFixed(20), fixed(units(before.balance.toFixed(20)) - units("0.01")));
  });
  await check("Ten concurrent deductions on a ¥1 wallet cannot overdraw across processes", async () => {
    await api(`/api/admin/users/${empty.id}/balance`, admin, 201, { method: "POST", body: adjustment("1.00") });
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => response(`/api/admin/users/${empty.id}/balance`, admin, { method: "POST", body: adjustment("0.30", "DEDUCT"), worker: i % 2 })));
    assert.equal(responses.filter((r) => r.status === 201).length, 3); assert.equal(responses.filter((r) => r.status === 409).length, 7); await Promise.all(responses.map((r) => r.arrayBuffer())); assert.equal((await wallet(empty)).balance.toFixed(20), "0.10000000000000000000");
  });
  await check("Database rejects missing reasons, inactive/non-admin actors and rewriting audit records", async () => {
    const data = { walletId: a.walletId, type: "ADMIN_ADJUSTMENT" as const, adminId: admin.id, adjustmentId: randomUUID(), amount: "1", balanceBefore: "1", balanceAfter: "2", description: "Rejected test adjustment" };
    await assert.rejects(db.walletTransaction.create({ data })); await assert.rejects(db.walletTransaction.create({ data: { ...data, reason: "Valid reason", adminId: a.id } }));
    await db.user.update({ where: { id: secondary.id }, data: { status: "SUSPENDED" } }); await assert.rejects(db.walletTransaction.create({ data: { ...data, reason: "Valid reason", adminId: secondary.id } })); await db.user.update({ where: { id: secondary.id }, data: { status: "ACTIVE" } });
    const entry = await db.walletTransaction.findFirstOrThrow({ where: { adminId: admin.id } }); await assert.rejects(db.walletTransaction.update({ where: { id: entry.id }, data: { reason: "Rewritten reason" } }));
    const usage = await db.walletTransaction.findFirstOrThrow({ where: { walletId: a.walletId, type: "USAGE" } }); await assert.rejects(db.walletTransaction.update({ where: { id: usage.id }, data: { type: "ADMIN_ADJUSTMENT", requestId: null, model: null, reason: "Recast usage", adminId: admin.id, adjustmentId: randomUUID() } }));
  });
  await check("Request date/user/model/status filters use matching aggregate and paginated queries", async () => {
    const value = await api<AdminRequestsData>(paths[2] + `?from=2026-01-10&to=2026-01-11&userId=${a.id}&modelId=${m1.slug}&status=SUCCESS`, admin), matching = records.filter((r) => r.userId === a.id && r.modelId === m1.id && r.createdAt >= jan10 && r.createdAt < jan12 && r.status === "SUCCESS");
    assert.deepEqual(value.stats, expected(matching)); assert.equal(value.pagination.total, matching.length); assert.equal(value.requests[0].user.id, a.id);
    const first = await api<AdminRequestsData>(paths[2] + `?userId=${a.id}&status=SUCCESS&pageSize=10`, admin), second = await api<AdminRequestsData>(paths[2] + `?userId=${a.id}&status=SUCCESS&pageSize=10&page=2`, admin); assert.equal(first.requests.length, 10); assert.equal(second.requests.length, 10); assert(!first.requests.some((r) => second.requests.some((s) => s.id === r.id))); assert.deepEqual(first.stats, second.stats);
    const unknown = first.stats.unknownCosts; assert.equal(unknown, "1"); const last = await api<AdminRequestsData>(paths[2] + `?modelId=${m1.id}&pageSize=50`, admin), historic = last.requests.find((r) => r.userCost === null && r.status === "SUCCESS"); assert(historic && historic.profit === null);
    const emptyPage = await api<AdminRequestsData>(paths[2] + `?userId=${empty.id}`, admin); assert.equal(emptyPage.requests.length, 0); assert.deepEqual(emptyPage.stats, expected([]));
  });
  await check("Payments support both providers, status/date/user filters and bounded stable paging", async () => {
    for (const method of ["ALIPAY", "WECHAT"]) {
      const value = await api<AdminPaymentsData>(paths[3] + `?method=${method}&status=PAID`, admin); assert(value.payments.length > 0); assert(value.payments.every((p) => p.method === method && p.status === "PAID" && p.paidAt)); assert.equal(value.payments[0].amount, "50.00");
    }
    const value = await api<AdminPaymentsData>(paths[3] + `?from=2026-01-10&to=2026-01-11&userId=${b.id}&method=WECHAT&status=CLOSED`, admin); assert.equal(value.payments.length, 1); assert.equal(value.payments[0].status, "CLOSED"); assert.equal(value.payments[0].paidAt, null);
    const first = await api<AdminPaymentsData>(paths[3] + `?userId=${a.id}&pageSize=10`, admin), second = await api<AdminPaymentsData>(paths[3] + `?userId=${a.id}&pageSize=10&page=2`, admin); assert.equal(first.payments.length, 10); assert(!first.payments.some((p) => second.payments.some((s) => s.id === p.id)));
    const before = await wallet(a); for (const path of paths) await api(path, admin); assert.equal((await wallet(a)).balance.toFixed(20), before.balance.toFixed(20));
    assert.equal((await api<AdminPaymentsData>(paths[3] + "?status=REFUNDED", admin)).payments.length, 0);
  });
  await check("Models include real lifetime/date-scoped totals, disabled models and unchanged sales pricing", async () => {
    await db.model.update({ where: { id: m1.id }, data: { enabled: false } });
    const all = await api<AdminModelsData>(paths[4] + `?search=${m1.slug}`, admin); assert.equal(all.models.length, 1); assert.equal(all.models[0].enabled, false); assert.deepEqual(all.models[0].stats, expected(records.filter((r) => r.modelId === m1.id))); assert.equal(all.models[0].inputPricePerMillion, "2.5");
    const dates = await api<AdminModelsData>(paths[4] + `?search=${m1.slug}&from=2026-01-10&to=2026-01-10`, admin); assert.deepEqual(dates.models[0].stats, expected(records.filter((r) => r.modelId === m1.id && r.createdAt >= new Date("2026-01-10") && r.createdAt < jan11)));
    const unchanged = all.models[0].stats; await api(`/api/admin/models/${m1.id}`, admin, 200, { method: "PATCH", body: { inputPricePerMillion: "123.456", markupMultiplier: "2" } }); const edited = await api<AdminModelsData>(paths[4] + `?search=${m1.slug}&provider=OPENAI`, admin); assert.deepEqual(edited.models[0].stats, unchanged); assert.equal(edited.models[0].inputPricePerMillion, "246.912");
    const publicResponse = await response("/api/models"); const publicData = await publicResponse.json(); assert(!JSON.stringify(publicData).includes(m1.slug) && !JSON.stringify(publicData).includes("stats"));
  });
  await check("Admin SSR renders actual rows and contains no demo text or private payment/auth data", async () => {
    for (const path of pages) {
      const r = await response(path, admin); assert.equal(r.status, 200); const body = await r.text(); boundary(body); assert(!body.includes("Demo workspace") && !body.includes("Changes reset") && !body.includes("Unable to load data"));
      if (path !== "/admin/models") assert(!body.includes(m1.providerModel));
      if (path === "/admin/users") assert(body.includes(a.email)); if (path === "/admin/requests") assert(body.includes(m1.slug));
      if (path === "/admin/payments") {
        const firstPage = await api<AdminPaymentsData>(paths[3], admin);
        assert(firstPage.payments.length > 0);
        for (const row of firstPage.payments) assert(body.includes(row.orderId), "Admin SSR must include every order in the current server page.");
      }
    }
    const invalid = await (await response("/admin/requests?userId=bad", admin)).text(); assert(invalid.includes("Clear filters")); assert(!invalid.includes(a.email));
  });
  await check("12,000 requests stay in PostgreSQL aggregates; all histories and model lists are bounded", async () => {
    const large = await owner(`Bulk ${seed}`, "0"), bulkModel = await model("bulk");
    for (let batch = 0; batch < 12; batch++) await db.apiRequest.createMany({ data: Array.from({ length: 1000 }, () => ({ userId: large.id, modelId: bulkModel.id, requestId: randomUUID(), status: "SUCCESS" as const, latencyMs: 123, inputTokens: 1, outputTokens: 2, totalTokens: 3, createdAt: recent })) });
    const data = await api<AdminRequestsData>(paths[2] + `?userId=${large.id}`, admin); assert.equal(data.stats.requests, "12000"); assert.equal(data.stats.tokens, "36000"); assert.equal(data.requests.length, 25); assert.equal(data.pagination.totalPages, 480); assert(JSON.stringify(data).length < 30000);
    const rows = Array.from({ length: 31 }, (_, i) => ({ id: randomUUID(), name: `Paged ${seed} ${i}`, email: `admin-${seed}-page-${i}@example.test`, passwordHash: "test-only-unusable-password", createdAt: recent }));
    await db.user.createMany({ data: rows });
    await db.model.createMany({ data: Array.from({ length: 31 }, (_, i) => ({ slug: `admin-${seed}-page-${i}`, name: `Paged ${seed} ${i}`, provider: "GOOGLE" as const, providerModel: "not-invoked", description: "Paged fixture", contextWindow: 1000, inputPricePerMillion: "1", outputPricePerMillion: "2", markupMultiplier: "1" })) });
    const userPage = await api<AdminUsersData>(paths[1] + `?search=${encodeURIComponent("Paged " + seed)}&pageSize=10&page=2`, admin); assert.equal(userPage.users.length, 10); assert.equal(userPage.pagination.total, 31);
    const modelPage = await api<AdminModelsData>(paths[4] + `?search=${encodeURIComponent("Paged " + seed)}&provider=GOOGLE&pageSize=10&page=2`, admin); assert.equal(modelPage.models.length, 10); assert.equal(modelPage.pagination.total, 31);
    const indexes = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename IN ('ApiRequest','PaymentOrder','User','WalletTransaction')`;
    for (const name of ["ApiRequest_createdAt_id_idx", "ApiRequest_status_createdAt_id_idx", "ApiRequest_provider_createdAt_id_idx", "ApiRequest_modelId_createdAt_idx", "PaymentOrder_createdAt_id_idx", "PaymentOrder_method_status_createdAt_id_idx", "User_status_createdAt_id_idx", "User_name_search_idx", "WalletTransaction_adminId_adjustmentId_key"]) assert(indexes.some((row) => row.indexname === name));
  });
  console.log(`Admin integration checks: ${passed} passed (isolated PostgreSQL and two production servers; no live provider/payment calls).`);
}
async function run() {
  try { await main(); }
  catch (error) {
    console.error(`FAIL ${activeCheck}. No secrets or raw response bodies were printed.`);
    if (error instanceof assert.AssertionError) {
      const safe = (value: unknown): unknown => {
        if (typeof value === "number" || typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return value;
        if (value && typeof value === "object") return Object.fromEntries(["requests", "tokens", "revenue", "providerCost", "profit", "unknownCosts"].filter((key) => key in value).map((key) => [key, safe((value as Record<string, unknown>)[key])]));
        return "[private]";
      };
      console.error(`Assertion: actual=${JSON.stringify(safe(error.actual))}, expected=${JSON.stringify(safe(error.expected))}`);
    }
    else if (error && typeof error === "object" && "code" in error && /^P\d{4}$/.test(String(error.code))) console.error(`Database error: ${error.code}`);
    else if (error instanceof Error) console.error(`Error class: ${error.constructor.name}`);
    process.exitCode = 1;
  } finally {
    for (const child of children) if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    await db.walletTransaction.deleteMany({ where: { adminId: { in: owners.map((u) => u.id) } } }).catch(() => { console.error("Admin audit fixture cleanup failed."); process.exitCode = 1; });
    await db.user.deleteMany({ where: { email: { startsWith: `admin-${seed}-` } } }).catch(() => { console.error("Admin user fixture cleanup failed."); process.exitCode = 1; });
    await db.model.deleteMany({ where: { slug: { startsWith: `admin-${seed}-` } } }).catch(() => { console.error("Admin model fixture cleanup failed."); process.exitCode = 1; });
    await risk.cleanup(); await db.$disconnect(); await getDb().$disconnect();
  }
}
void run().catch(() => { console.error("Admin cleanup failed."); process.exitCode = 1; });
