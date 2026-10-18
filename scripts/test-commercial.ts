import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type PaymentOrder } from "../generated/prisma/client";
import { money, calculateCosts } from "../lib/billing/money";
import { createPaymentOrder, reconcileOwnedPayment } from "../lib/payments/orders";
import { settleSuccess } from "../lib/billing/wallet";
import { getDb } from "../lib/server/db";
import { riskTestEnvironment } from "./risk-test-environment";
import { alipayConfig, alipayNotification, localAlipay, localWechat, merchantKeys, platformKeys, platformStates, wechatConfig, wechatNotification } from "./payment-fixtures";
import type { BillingData, UsageData } from "../lib/analytics-types";
import type { PaymentStatusData } from "../lib/payment-types";

// Only explicit, separate local fixture databases are accepted. No dotenv load.
const databaseUrl = process.env.DATABASE_URL_TEST;
assert(process.env.TD_COMMERCIAL_ISOLATED === "1" && databaseUrl && databaseUrl !== process.env.DATABASE_URL);
const url = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/aihub_auth_test");
const risk = riskTestEnvironment("commercial");
// Deliberately do not copy the suite helper's elevated quota overrides.
const defaults = { AIHUB_LOCAL_PROVIDER_TESTS: "true", REDIS_URL: risk.env.REDIS_URL, REDIS_NAMESPACE: risk.namespace,
  IP_HASH_SECRET: risk.env.IP_HASH_SECRET, UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", TRUSTED_IP_HEADER: "" };
Object.assign(process.env, defaults, { DATABASE_URL: databaseUrl });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 5 }), log: [] });
const seed = randomBytes(8).toString("hex"), password = randomBytes(32).toString("base64url");
const origin = "http://127.0.0.1:3150", upstreamOrigin = "http://127.0.0.1:3151/v1";
const upstreamKey = `fixture-${randomBytes(32).toString("hex")}`;
const evidence = process.env.COMMERCIAL_EVIDENCE_DIR ?? "/commercial-evidence";
const runMeta = { runId: process.env.TD_COMMERCIAL_RUN_ID === "manual" ? randomUUID() : process.env.TD_COMMERCIAL_RUN_ID ?? randomUUID(),
  project: process.env.TD_COMMERCIAL_TEST_PROJECT ?? "manual-isolated-fixture", startedAt: new Date().toISOString() };
const keyDirectory = resolve(evidence, `temporary-merchant-${seed}`);
const cases: string[] = [], requestIds: string[] = [];
let child: ChildProcess | undefined, fixture: Awaited<ReturnType<typeof localAlipay>> | undefined;
let activeCheck = "startup", capturedOutput = "", upstreamCalls = 0, userId = "", otherId = "";
type Owner = { id: string; cookie: string };
const modelSlug = `commercial-${seed}`;
const upstream = createServer(async (request, response) => {
  try {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, `Bearer ${upstreamKey}`);
    assert.equal(body.model, `native-${seed}`); assert.equal(body.thinking?.type, "disabled");
    upstreamCalls++;
    const usage = { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 8 };
    const choice = { index: 0, message: { role: "assistant", content: "Isolated commercial verification." }, finish_reason: "stop" };
    if (!body.stream) { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ choices: [choice], usage })); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "Isolated " }, finish_reason: null }] })}\n\n`);
    setTimeout(() => { if (!response.destroyed) response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "verification." }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`); }, 150);
  } catch { response.writeHead(500); response.end(); }
});
const save = (name: string, value: Record<string, unknown>) => writeFileSync(resolve(evidence, name), JSON.stringify({ ...runMeta, ...value }, null, 2) + "\n");
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); cases.push(name); console.log(`PASS ${name}`); }
function safe(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [password, upstreamKey, merchantKeys.privateKey, wechatConfig.apiV3Key]) assert(!text.includes(secret));
  assert(!/"(?:passwordHash|keyHash|apiV3Key|privateKey)"/.test(text));
}
async function request(path: string, owner?: Owner, options: RequestInit = {}) {
  return fetch(origin + path, { ...options, redirect: "manual", headers: { ...(owner ? { Cookie: owner.cookie } : {}), ...options.headers }, signal: AbortSignal.timeout(30000) });
}
const mutation = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
async function json<T>(response: Response, status = 200): Promise<T> { assert.equal(response.status, status); const body = await response.json() as T; safe(body); return body; }
async function register(label: string): Promise<Owner> {
  const response = await request("/api/auth/register", undefined, mutation({ name: "Isolated commercial user", email: `${label}-${seed}@example.test`, password, confirmPassword: password }));
  const body = await json<{ user: { id: string } }>(response, 201);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("__Host-aihub-session="))?.split(";")[0];
  assert(cookie); return { id: body.user.id, cookie };
}
async function wallet(id: string) { return db.wallet.findUniqueOrThrow({ where: { userId: id } }); }
async function aliCallback(order: PaymentOrder, changes: Record<string, string> = {}, valid = true) {
  return request("/api/payments/callbacks/alipay", undefined, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: alipayNotification(order, changes, valid) });
}
async function wxCallback(order: PaymentOrder, changes: object = {}, badSignature = false) {
  return request("/api/payments/callbacks/wechat", undefined, { method: "POST", ...wechatNotification(order, changes, { badSignature }) });
}
async function chat(key: string, stream = false) {
  const response = await request("/v1/chat/completions", undefined, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelSlug, messages: [{ role: "user", content: "Local acceptance only." }], max_tokens: 32, stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}) }) });
  if (response.ok) { const id = response.headers.get("x-request-id"); assert(id); requestIds.push(id); }
  return response;
}
async function main() {
  const runDirectory = resolve(evidence, "runs", runMeta.runId); mkdirSync(runDirectory, { recursive: true });
  for (const file of ["test-result.json", "test-failure.json"]) if (existsSync(resolve(evidence, file))) copyFileSync(resolve(evidence, file), resolve(runDirectory, "previous-child-" + file));
  save("test-result.json", { status: "RUNNING", passed: 0, failed: null });
  save("test-failure.json", { status: "RUNNING", activeCheck: "startup", passed: 0 });
  mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries({ "merchant.pem": merchantKeys.privateKey, "platform.pem": platformKeys.publicKey, "api-v3.txt": wechatConfig.apiV3Key })) writeFileSync(resolve(keyDirectory, name), value, { mode: 0o600 });
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, stdio: "pipe" });
  const model = await db.model.create({ data: { slug: modelSlug, name: "Commercial isolated fixture", provider: "DEEPSEEK", providerModel: `native-${seed}`,
    description: "Synthetic test model; never an actual sellable listing.", contextWindow: 8192, inputPricePerMillion: "2", outputPricePerMillion: "8", markupMultiplier: "1.25", enabled: true } });
  const channel = await db.providerChannel.create({ data: { code: `commercial-${seed}`, name: "No-egress local Mock", provider: "DEEPSEEK", apiKeyEnv: "DEEPSEEK_API_KEY", baseUrlEnv: "DEEPSEEK_BASE_URL", timeoutMs: 3000 } });
  await db.modelChannel.create({ data: { modelId: model.id, channelId: channel.id, providerModel: model.providerModel, contextWindow: model.contextWindow, inputPricePerMillion: "2", outputPricePerMillion: "8" } });
  fixture = await localAlipay();
  await new Promise<void>(resolve => upstream.listen(3151, "127.0.0.1", resolve));
  const env: NodeJS.ProcessEnv = { ...process.env, ...defaults, NODE_ENV: "production", APP_ORIGIN: origin, PAYMENT_NOTIFY_ORIGIN: "https://payments.example.test", PAYMENTS_ENABLED: "true",
    OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", DEEPSEEK_API_KEY: upstreamKey, DEEPSEEK_BASE_URL: upstreamOrigin, DEEPSEEK_TIMEOUT_MS: "3000", ROUTER_MAX_RETRIES: "0",
    ALIPAY_APP_ID: alipayConfig.appId, ALIPAY_SELLER_ID: alipayConfig.merchantId, ALIPAY_PRIVATE_KEY_PATH: resolve(keyDirectory, "merchant.pem"), ALIPAY_PUBLIC_KEY_PATH: resolve(keyDirectory, "platform.pem"),
    WECHAT_APP_ID: wechatConfig.appId, WECHAT_MCH_ID: wechatConfig.merchantId, WECHAT_CERT_SERIAL: wechatConfig.certificateSerial, WECHAT_PUBLIC_KEY_ID: wechatConfig.publicKeyId,
    WECHAT_PRIVATE_KEY_PATH: resolve(keyDirectory, "merchant.pem"), WECHAT_PUBLIC_KEY_PATH: resolve(keyDirectory, "platform.pem"), WECHAT_API_V3_KEY_PATH: resolve(keyDirectory, "api-v3.txt") };
  const running = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3150"], { env, stdio: ["ignore", "pipe", "pipe"] });
  child = running;
  for (const stream of [running.stdout, running.stderr]) stream?.on("data", data => { capturedOutput += data; });
  const deadline = Date.now() + 30000;
  while (!await request("/api/auth/session").then(r => r.ok).catch(() => false)) {
    assert(running.exitCode === null && Date.now() < deadline, "Local production server did not start."); await new Promise(resolve => setTimeout(resolve, 100));
  }
  let a: Owner, b: Owner, key = "", apiKeyId = "";
  await check("Real register, logout and login issue an isolated session and zero-CNY wallet", async () => {
    a = await register("commercial-a"); b = await register("commercial-b"); userId = a.id; otherId = b.id;
    assert(money((await wallet(a.id)).balance).isZero());
    assert.equal((await request("/api/auth/logout", a, mutation({}))).status, 200);
    const response = await request("/api/auth/login", undefined, mutation({ email: `commercial-a-${seed}@example.test`, password, rememberMe: true }));
    await json(response); const cookie = response.headers.getSetCookie().find(value => value.startsWith("__Host-aihub-session="))?.split(";")[0]; assert(cookie); a.cookie = cookie;
  });
  await check("Invalid signature and tampered amount cannot credit an Alipay recharge", async () => {
    const order = await createPaymentOrder(a.id, { method: "ALIPAY", amount: "5.00" }, randomUUID(), fixture!.adapter);
    assert.equal(order.status, "PENDING"); assert(order.qrCodeDataUrl); save("pending-order.json", { method: order.method, status: order.status, amount: order.amount.toFixed(2) });
    assert.equal((await aliCallback(order, {}, false)).status, 400); assert.equal((await aliCallback(order, { total_amount: "500.00" })).status, 400);
    assert(money((await wallet(a.id)).balance).isZero());
    for (const response of await Promise.all(Array.from({ length: 10 }, () => aliCallback(order)))) assert.equal(response.status, 200);
    assert.equal((await wallet(a.id)).balance.toFixed(2), "5.00"); assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: order.id } }), 1);
    assert.equal((await request(`/api/payments/${order.id}/status`, b)).status, 404);
  });
  await check("WeChat RSA/AES-GCM notifications credit once; failed and expired orders credit nothing", async () => {
    const order = await createPaymentOrder(a.id, { method: "WECHAT", amount: "1.01" }, randomUUID(), localWechat);
    assert.equal((await wxCallback(order, {}, true)).status, 400);
    assert.equal((await wxCallback(order, { amount: { total: 102, currency: "CNY" } })).status, 400);
    for (const response of await Promise.all([wxCallback(order), wxCallback(order)])) assert.equal(response.status, 204);
    assert.equal((await wallet(a.id)).balance.toFixed(2), "6.01"); assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: order.id } }), 1);
    const failed = await createPaymentOrder(a.id, { method: "WECHAT", amount: "2.00" }, randomUUID(), localWechat);
    platformStates.get(failed.orderNo)!.status = "FAILED";
    assert.equal((await reconcileOwnedPayment(a.id, failed.id, localWechat)).status, "FAILED");
    // Existing financial terms are immutable, including expiration. Keep the guard.
    await assert.rejects(db.paymentOrder.update({ where: { id: failed.id, userId: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const expired = await db.paymentOrder.create({ data: { userId: a.id, orderNo: `AH${randomBytes(14).toString("hex")}`, idempotencyKey: randomUUID(),
      method: "WECHAT", merchantId: wechatConfig.merchantId, appId: wechatConfig.appId, amount: "2.00",
      createdAt: new Date(Date.now() - 301000), expiresAt: new Date(Date.now() - 1000) } });
    const status = await json<PaymentStatusData>(await request(`/api/payments/${expired.id}/status`, a));
    assert.equal(status.order.status, "CLOSED"); assert.equal((await wallet(a.id)).balance.toFixed(2), "6.01");
    assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: { in: [failed.id, expired.id] } } }), 0);
  });
  await check("Create key returns its secret once, persists a hash and enforces ownership", async () => {
    const created = await json<{ key: string; apiKey: { id: string } }>(await request("/api/api-keys", a, mutation({ name: "Commercial acceptance" })), 201);
    key = created.key; apiKeyId = created.apiKey.id; assert(key.startsWith("sk-aihub-"));
    const record = await db.apiKey.findFirstOrThrow({ where: { id: apiKeyId, userId: a.id } }); assert.equal(record.keyHash, createHash("sha256").update(key).digest("hex"));
    assert(!JSON.stringify(await json(await request("/api/api-keys", a))).includes(key));
    assert.equal((await request(`/api/api-keys/${apiKeyId}`, b, mutation({ name: "Cross-user attack" }, "PATCH"))).status, 404);
    assert.equal((await request("/api/admin/models", a, mutation({}))).status, 403);
  });
  await check("Database selling prices match public catalog without exposing provider costs", async () => {
    const catalog = await json<{ models: { slug: string; inputPricePerMillion: string; outputPricePerMillion: string }[] }>(await request("/api/models"));
    const publicModel = catalog.models.find(value => value.slug === modelSlug); assert(publicModel); assert.equal(publicModel.inputPricePerMillion, "2.5"); assert.equal(publicModel.outputPricePerMillion, "10");
    assert(!JSON.stringify(catalog).includes("markupMultiplier") && !JSON.stringify(catalog).includes("providerModel"));
    for (const path of ["/models", "/pricing", "/dashboard/models"]) { const page = await request(path, a); assert.equal(page.status, 200); const html = await page.text(); assert(html.includes(modelSlug)); assert(!html.includes(`native-${seed}`)); }
  });
  await check("Nonstream and SSE use model slug, real fixture usage and one Decimal charge each", async () => {
    const body = await json<{ model: string; usage: { prompt_tokens: number; completion_tokens: number } }>(await chat(key));
    assert.equal(body.model, modelSlug); assert.equal(body.usage.prompt_tokens, 12); assert.equal(body.usage.completion_tokens, 7);
    const response = await chat(key, true); assert.equal(response.status, 200); const text = await response.text(); safe(text);
    assert.equal((text.match(/data: \[DONE\]/g) ?? []).length, 1); assert(text.includes('"prompt_tokens":12') && !text.includes(`native-${seed}`));
    for (const requestId of requestIds) { const row = await db.apiRequest.findFirstOrThrow({ where: { requestId, userId: a.id } }); assert.equal(row.status, "SUCCESS"); assert.equal(row.userCost?.toFixed(20), "0.00010000000000000000"); assert.equal(row.providerCost?.toFixed(20), "0.00008000000000000000"); assert.equal(await db.walletTransaction.count({ where: { requestId } }), 1); }
  });
  await check("Ten concurrent requests and ten settlement retries preserve the wallet ledger", async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => chat(key, true)));
    for (const response of responses) { assert.equal(response.status, 200); assert((await response.text()).includes("data: [DONE]")); }
    await Promise.all(Array.from({ length: 10 }, () => settleSuccess(a.id, requestIds[0], { inputTokens: 12, outputTokens: 7, totalTokens: 19 }, 1)));
    const rows = await db.walletTransaction.findMany({ where: { walletId: (await wallet(a.id)).id } });
    const sum = rows.reduce((total, row) => { assert(money(row.balanceBefore).plus(money(row.amount)).eq(money(row.balanceAfter))); return total.plus(money(row.amount)); }, money("0"));
    const current = await wallet(a.id); assert(sum.eq(money(current.balance))); assert(!money(current.balance).isNegative()); assert(money(current.reservedBalance).isZero());
    assert.equal(rows.filter(row => row.type === "RECHARGE").length, 2); assert.equal(rows.filter(row => row.type === "USAGE").length, 12);
  });
  await check("Zero balance, revoked key and cross-user analytics cannot bypass billing", async () => {
    const emptyKey = await json<{ key: string }>(await request("/api/api-keys", b, mutation({ name: "Zero balance" })), 201);
    const before = upstreamCalls; assert.equal((await chat(emptyKey.key)).status, 402); assert.equal(upstreamCalls, before);
    const rejected = await request(`/api/api-keys/${apiKeyId}/revoke`, a, mutation({})); assert.equal(rejected.status, 200);
    assert.equal((await chat(key)).status, 401); assert.equal(upstreamCalls, before);
    assert.equal((await request(`/api/dashboard/usage?range=7D&pageSize=50&userId=${a.id}`, b)).status, 400);
    const usage = await json<UsageData>(await request("/api/dashboard/usage?range=7D&pageSize=50", b));
    // The authenticated 402 is itself an auditable FAILED request owned by B.
    assert.equal(usage.stats.requests, "1"); assert.equal(usage.stats.failedRequests, "1"); assert(money(usage.stats.spend).isZero());
    assert(usage.requests.every(row => !requestIds.includes(row.requestId)));
    assert(money((await wallet(b.id)).balance).isZero());
  });
  await check("Usage and Billing show the exact charges and both recharge histories", async () => {
    const usage = await json<UsageData>(await request("/api/dashboard/usage?range=7D&pageSize=50", a));
    assert.equal(usage.stats.requests, "12"); assert.equal(usage.stats.tokens, "228"); assert(money(usage.stats.spend).eq("0.0012"));
    const billing = await json<BillingData>(await request("/api/dashboard/billing?pageSize=50", a));
    assert(money(billing.availableBalance).eq("6.0088")); assert(money(billing.lifetimeSpend).eq("0.0012"));
    assert.equal(billing.transactions.length, 14); assert.equal(billing.recharges.filter(row => row.status === "PAID").length, 2);
    const keyMetadata = await db.apiKey.findFirstOrThrow({ where: { id: apiKeyId, userId: a.id } }); assert(keyMetadata.lastUsedAt);
    save("closed-loop.json", { passed: cases.length + 1, userIds: [userId, otherId], successfulRequests: requestIds.length, usage, billing, fundingCny: "6.01", userCostCny: "0.0012", providerCostCny: "0.00096", expectedBalanceCny: "6.0088", realPayment: false, realProvider: false, defaultQuotasRetained: true,
      paymentCreationBoundary: "Trusted server-side adapter injection; HTTP callback signature/amount/idempotency and owned status routes are real. No production mock flag added." });
  });
  await check("Provider cache breakdown is a documented cost gap, not silently declared reconciled", async () => {
    const nominal = calculateCosts(12, 7, { inputPricePerMillion: "2", outputPricePerMillion: "8", markupMultiplier: "1.25" });
    const peakCacheAware = money("4").times("0.04").plus(money("8").times("2")).plus(money("7").times("8")).div("1000000");
    assert.equal(nominal.providerCost, "0.00008000000000000000"); assert.equal(peakCacheAware.toFixed(20), "0.00007216000000000000");
    assert(!peakCacheAware.eq(nominal.providerCost));
    save("pricing-limitation.json", { nominalProviderCost: nominal.providerCost, referencePeakCacheAwareCost: peakCacheAware.toFixed(20), referenceRatesCnyPerMillion: { hit: "0.04", miss: "2", output: "8" }, gap: "No cache/time-of-day cost dimensions in current billing. Fixed-price customer arithmetic passes; actual provider profit is not reconciled.", officialSource: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/", fixtureOnly: true });
  });
  for (const secret of [password, upstreamKey, merchantKeys.privateKey, wechatConfig.apiV3Key]) assert(!capturedOutput.includes(secret));
  save("test-result.json", { status: "PASS", passed: cases.length, failed: 0, cases, executedAt: new Date().toISOString(), realTransactionsVerified: false });
  save("test-failure.json", { status: "NONE", passed: cases.length, failed: 0 });
  console.log(`Commercial closed-loop: ${cases.length} passed. Mock payments/providers only; no production credentials.`);
}
void main().catch(error => {
  const numeric = (value: unknown) => typeof value === "number" ? value : undefined;
  save("test-failure.json", { status: "FAILED", activeCheck, errorClass: error instanceof Error ? error.name : "Unknown", passed: cases.length,
    location: error instanceof Error ? error.stack?.split("\n").filter(line => /test-commercial\.ts:\d+/.test(line)).map(line => line.trim()) : [],
    ...(error instanceof assert.AssertionError ? { actual: numeric(error.actual), expected: numeric(error.expected) } : {}) });
  save("test-result.json", { status: "FAILED", passed: cases.length, failed: 1, activeCheck, executedAt: new Date().toISOString() });
  console.error(`FAIL ${activeCheck}: details suppressed to protect fixture credentials.`); process.exitCode = 1;
}).finally(async () => {
  if (child && child.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; }
  upstream.closeAllConnections(); if (upstream.listening) await new Promise<void>(resolve => upstream.close(() => resolve()));
  fixture?.server.closeAllConnections(); if (fixture?.server.listening) await new Promise<void>(resolve => fixture!.server.close(() => resolve()));
  await db.$disconnect(); await getDb().$disconnect(); await risk.cleanup();
  rmSync(keyDirectory, { recursive: true, force: true }); // Only this run's generated, random fixture directory.
}).catch(() => { save("test-result.json", { status: "FAILED", passed: cases.length, failed: 1, activeCheck: "cleanup", executedAt: new Date().toISOString() }); console.error("Commercial fixture cleanup failed; details suppressed."); process.exitCode = 1; });
