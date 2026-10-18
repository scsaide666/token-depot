import { riskTestEnvironment } from "./risk-test-environment";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type PaymentOrder } from "../generated/prisma/client";
import { getDb } from "../lib/server/db";
import { hashPassword } from "../lib/server/password";
import { HttpError } from "../lib/server/http-error";
import { createPaymentOrder, applyVerifiedPayment, reconcileOwnedPayment } from "../lib/payments/orders";
import { PaymentProviderError, type PaymentProvider, type VerifiedReceipt } from "../lib/payments/providers/types";
import type { BillingData } from "../lib/analytics-types";
import type { PaymentStatusData, RechargeHistoryData } from "../lib/payment-types";
import { verifyCurrencyMigration } from "./currency-migration-fixture";
import { alipayConfig, alipayNotification, localAlipay, localWechat, merchantKeys, platformKeys, platformCalls, platformStates, wechatConfig, wechatNotification } from "./payment-fixtures";

config({ quiet: true });
const risk = riskTestEnvironment("payments");
Object.assign(process.env, risk.env);
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl || databaseUrl === process.env.DATABASE_URL) throw new Error("An isolated payment test database is required.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test");
process.env.DATABASE_URL = databaseUrl;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 5 }), log: [] });
const seed = randomBytes(8).toString("hex"), workRoot = resolve("../../work"), keyDirectory = resolve(workRoot, `payment-fixture-${seed}`);
const origins = [3120, 3121, 3122].map((port) => `http://127.0.0.1:${port}`), children: ChildProcess[] = [];
type Owner = { id: string; walletId: string; cookie: string };
const owners: Owner[] = [];
let alipay: Awaited<ReturnType<typeof localAlipay>> | undefined, passed = 0, activeCheck = "startup";
async function owner(balance = "32.43", role: "USER" | "ADMIN" = "USER"): Promise<Owner> {
  const user = await db.user.create({ data: { name: "Payment fixture", email: `payments-${seed}-${owners.length}@example.test`, passwordHash: await hashPassword(randomBytes(32).toString("hex")), role, wallet: { create: { balance } } }, include: { wallet: true } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), userAgent: "Payment integration fixture" } });
  const result = { id: user.id, walletId: user.wallet!.id, cookie: `__Host-aihub-session=${token}` }; owners.push(result); return result;
}
async function rawOrder(u: Owner, method: "ALIPAY" | "WECHAT" = "ALIPAY", overrides: { expiresAt?: Date; createdAt?: Date; amount?: string } = {}) {
  const identity = method === "ALIPAY" ? alipayConfig : wechatConfig;
  return db.paymentOrder.create({ data: { userId: u.id, orderNo: `AH${randomBytes(14).toString("hex")}`, idempotencyKey: randomUUID(), method, merchantId: identity.merchantId, appId: identity.appId, amount: overrides.amount ?? "5.00", expiresAt: overrides.expiresAt ?? new Date(Date.now() + 300000), ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}) } });
}
async function wallet(u: Owner) { return db.wallet.findUniqueOrThrow({ where: { userId: u.id } }); }
function boundary(data: unknown) {
  const value = JSON.stringify(data);
  for (const field of ["userId", "merchantId", "appId", "providerTransactionId", "idempotencyKey", "codeUrl", "privateKey", "signature", "passwordHash", "keyHash", "apiV3Key"]) assert(!value.includes(`"${field}"`), "Payment DTO must exclude private fields.");
  assert(!value.includes("BEGIN PRIVATE KEY") && !value.includes(wechatConfig.apiV3Key));
}
async function request(path: string, u?: Owner, options: RequestInit = {}, server = 0) {
  return fetch(origins[server] + path, { ...options, headers: { ...(u ? { Cookie: u.cookie } : {}), ...options.headers }, redirect: "manual", signal: AbortSignal.timeout(30000) });
}
async function api<T>(path: string, u?: Owner, status = 200, options: RequestInit = {}, server = 0): Promise<T> {
  const response = await request(path, u, options, server); assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json() as T; boundary(data); return data;
}
function mutation(body: unknown, server = 0, attempt = randomUUID()): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", Origin: origins[server], "Idempotency-Key": attempt }, body: JSON.stringify(body) };
}
function statusPath(order: PaymentOrder) { return `/api/payments/${order.id}/status`; }
async function callback(order: PaymentOrder, server = 0, changes: Record<string, string> = {}, valid = true) {
  return request("/api/payments/callbacks/alipay", undefined, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: alipayNotification(order, changes, valid) }, server);
}
async function wxCallback(order: PaymentOrder, changes: object = {}, options: Parameters<typeof wechatNotification>[2] = {}, server = 0) {
  return request("/api/payments/callbacks/wechat", undefined, { method: "POST", ...wechatNotification(order, changes, options) }, server);
}
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); passed++; console.log(`PASS ${name}`); }
async function expectHttp(action: Promise<unknown>, code: number) { await assert.rejects(action, (error) => error instanceof HttpError && error.status === code); }
async function startup() {
  mkdirSync(keyDirectory, { recursive: true });
  const keyPaths = { privateKey: resolve(keyDirectory, "merchant.pem"), publicKey: resolve(keyDirectory, "platform.pem"), apiV3: resolve(keyDirectory, "api-v3.txt") };
  writeFileSync(keyPaths.privateKey, merchantKeys.privateKey, { mode: 0o600 }); writeFileSync(keyPaths.publicKey, platformKeys.publicKey); writeFileSync(keyPaths.apiV3, wechatConfig.apiV3Key, { mode: 0o600 });
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production", PAYMENT_NOTIFY_ORIGIN: "https://payments.example.test",
    ALIPAY_APP_ID: alipayConfig.appId, ALIPAY_SELLER_ID: alipayConfig.merchantId, ALIPAY_PRIVATE_KEY_PATH: keyPaths.privateKey, ALIPAY_PUBLIC_KEY_PATH: keyPaths.publicKey,
    WECHAT_APP_ID: wechatConfig.appId, WECHAT_MCH_ID: wechatConfig.merchantId, WECHAT_CERT_SERIAL: wechatConfig.certificateSerial, WECHAT_PRIVATE_KEY_PATH: keyPaths.privateKey, WECHAT_PUBLIC_KEY_ID: wechatConfig.publicKeyId, WECHAT_PUBLIC_KEY_PATH: keyPaths.publicKey, WECHAT_API_V3_KEY_PATH: keyPaths.apiV3 };
  try { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: baseEnv, windowsHide: true, stdio: "pipe" }); } catch { throw new Error("Isolated payment migration failed."); }
  for (let i = 0; i < origins.length; i++) {
    assert(await fetch(origins[i], { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Payment test port must be free.");
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(3120 + i)], { env: { ...baseEnv, APP_ORIGIN: origins[i], PAYMENTS_ENABLED: i === 2 ? "false" : "true" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(child);
    child.stdout?.on("data", () => {}); child.stderr?.on("data", () => {}); let failed = false; child.on("error", () => { failed = true; });
    const deadline = Date.now() + 30000;
    while (!await fetch(origins[i] + "/api/auth/session", { signal: AbortSignal.timeout(1000) }).then((r) => r.status === 200).catch(() => false)) {
      if (failed || child.exitCode !== null || Date.now() > deadline) throw new Error("Payment test server failed to start. Build first.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  alipay = await localAlipay();
}
async function main() {
  await startup();
  await check("USD to CNY conversion is atomic, exact at 20 decimals and cannot run twice", () => verifyCurrencyMigration(databaseUrl!));
  const a = await owner(), b = await owner("100", "ADMIN"), empty = await owner("0");
  let aliOrder: PaymentOrder, wxOrder: PaymentOrder;
  await check("Native order creation stores original CNY amount and QR without crediting a wallet", async () => {
    aliOrder = await createPaymentOrder(a.id, { method: "ALIPAY", amount: "50.00" }, randomUUID(), alipay!.adapter);
    wxOrder = await createPaymentOrder(b.id, { method: "WECHAT", amount: "1.01" }, randomUUID(), localWechat);
    for (const order of [aliOrder, wxOrder]) { assert.equal(order.status, "PENDING"); assert(order.qrCodeDataUrl?.startsWith("data:image/png;base64,")); assert(order.codeUrl); assert.equal(order.currency, "CNY"); assert.equal(order.settledAt, null); }
    assert.equal(wxOrder.amount.toFixed(2), "1.01"); assert.equal(platformStates.get(wxOrder.orderNo)?.amount, "1.01");
    assert.equal((await wallet(a)).balance.toFixed(2), "32.43"); assert.equal(await db.walletTransaction.count({ where: { walletId: a.walletId } }), 0);
  });
  await check("Alipay V3 order query uses its signed POST JSON contract", async () => {
    const before = platformCalls.query;
    const receipt = await alipay!.adapter.query(aliOrder!);
    assert.equal(receipt.status, "PENDING");
    assert.equal(receipt.orderNo, aliOrder!.orderNo);
    assert.equal(platformCalls.query, before + 1);
  });
  await check("Concurrent order retries reuse one owned attempt and reject changed details", async () => {
    const u = await owner(), attempt = randomUUID(), before = platformCalls.create;
    const results = await Promise.all(Array.from({ length: 10 }, () => createPaymentOrder(u.id, { method: "ALIPAY", amount: "20" }, attempt, alipay!.adapter)));
    assert.equal(new Set(results.map((order) => order.id)).size, 1); assert.equal(platformCalls.create - before, 1);
    await expectHttp(createPaymentOrder(u.id, { method: "ALIPAY", amount: "21" }, attempt, alipay!.adapter), 409);
  });
  await check("Waiting status polling only reads owned state and excludes merchant/signature secrets", async () => {
    const before = platformCalls.query;
    for (let i = 0; i < 3; i++) { const data = await api<PaymentStatusData>(statusPath(aliOrder!), a); assert.equal(data.order.status, "PENDING"); assert.equal(data.order.amount, "50.00"); assert.equal(data.availableBalance, "32.43000000000000000000"); assert(data.qrCodeDataUrl); }
    assert.equal(platformCalls.query, before); assert.equal((await wallet(a)).balance.toFixed(2), "32.43");
  });
  await check("Missing merchant configuration disables creation with no order or balance changes", async () => {
    const before = await db.paymentOrder.count({ where: { userId: a.id } });
    for (const method of ["ALIPAY", "WECHAT"]) await api("/api/payments", a, 503, mutation({ method, amount: "50" }, 2), 2);
    assert.equal(await db.paymentOrder.count({ where: { userId: a.id } }), before);
    const data = await api<BillingData>("/api/dashboard/billing", a, 200, {}, 2); assert.equal(data.paymentOptions.enabled, false); assert(data.paymentOptions.methods.every((item) => !item.enabled));
  });
  await check("Session, CSRF, strict amounts and ownership overrides fail before provider calls", async () => {
    await api(statusPath(aliOrder!), undefined, 401); await api("/api/payments", undefined, 401);
    await api("/api/payments", a, 403, { ...mutation({ method: "ALIPAY", amount: "50" }), headers: { "Content-Type": "application/json", Origin: "https://foreign.example.test" } });
    const invalidBodies = [{ method: "ALIPAY", amount: "50", userId: b.id }, { method: "ALIPAY", amount: "50", status: "PAID" }, { method: "ALIPAY", amount: 50 }, ...["0", "-1", "0.99", "10000.01", "1.001", "1e2", "NaN"].map((amount) => ({ method: "ALIPAY", amount }))];
    for (let index = 0; index < invalidBodies.length; index++) { activeCheck = `Strict payment body case ${index}`; await api("/api/payments", a, 400, mutation(invalidBodies[index])); }
    activeCheck = "Missing payment attempt header";
    await api("/api/payments", a, 400, { ...mutation({ method: "ALIPAY", amount: "5" }), headers: { "Content-Type": "application/json", Origin: origins[0] } });
    await db.user.update({ where: { id: empty.id }, data: { status: "SUSPENDED" } }); await api("/api/payments", empty, 401); await db.user.update({ where: { id: empty.id }, data: { status: "ACTIVE" } });
  });
  await check("Users and ADMIN cannot read or refresh another user's order", async () => {
    for (const [u, other] of [[a, wxOrder!], [b, aliOrder!]] as const) {
      await api(statusPath(other), u, 404); await api(`/api/payments/${other.id}/refresh`, u, 404, mutation({}));
      // Next may have already streamed the layout before notFound sets the page boundary.
      const page = await request(`/dashboard/billing/payments/${other.id}`, u), html = await page.text();
      assert([200, 404].includes(page.status)); assert(html.includes("404") && /not found|could not be found/i.test(html), "Foreign checkout must render the not-found boundary."); assert(!html.includes(other.orderNo));
      await api(statusPath(other) + `?userId=${u.id}`, u, 400);
    }
    await api(`/api/payments/${randomUUID()}/status`, a, 404); await api("/api/payments?userId=" + b.id, a, 400);
    await expectHttp(reconcileOwnedPayment(a.id, wxOrder!.id, localWechat), 404);
  });
  await check("Invalid Alipay signatures, duplicate fields and signed amount/merchant mismatches never credit", async () => {
    const before = (await wallet(a)).balance.toFixed(20);
    assert.equal((await callback(aliOrder!, 0, {}, false)).status, 400);
    for (const changes of [{ total_amount: "51.00" }, { app_id: "different" }, { seller_id: "different" }, { out_trade_no: "unknown" }] as Record<string, string>[]) assert.equal((await callback(aliOrder!, 0, changes)).status, changes.out_trade_no ? 404 : 400);
    assert.equal((await request("/api/payments/callbacks/alipay", undefined, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: alipayNotification(aliOrder!) + "&total_amount=50.00" })).status, 400);
    assert.equal((await wallet(a)).balance.toFixed(20), before); assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: aliOrder!.id } }), 0);
  });
  await check("WeChat verifies RSA signature, key ID, AEAD tag, merchant and original amount", async () => {
    const before = (await wallet(b)).balance.toFixed(20);
    for (const options of [{ badSignature: true }, { badTag: true }, { serial: "unknown-key" }]) assert.equal((await wxCallback(wxOrder!, {}, options)).status, 400);
    for (const changes of [{ amount: { total: 102, currency: "CNY" } }, { amount: { total: 101, currency: "USD" } }, { mchid: "different" }, { appid: "different" }]) assert.equal((await wxCallback(wxOrder!, changes)).status, 400);
    const stale = wechatNotification(wxOrder!); assert.equal((await request("/api/payments/callbacks/wechat", undefined, { method: "POST", ...stale, headers: { ...stale.headers, "wechatpay-timestamp": "1000000000" } })).status, 400);
    assert.equal((await wallet(b)).balance.toFixed(20), before); assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: wxOrder!.id } }), 0);
    await assert.rejects(applyVerifiedPayment({ method: "ALIPAY", orderNo: aliOrder!.orderNo, amount: "50.00", status: "PAID" } as unknown as VerifiedReceipt));
  });
  await check("Alipay success atomically credits the original amount and refreshes balance and histories", async () => {
    assert.equal((await callback(aliOrder!)).status, 200);
    const data = await api<PaymentStatusData>(statusPath(aliOrder!), a); assert.equal(data.order.status, "PAID"); assert.equal(data.qrCodeDataUrl, null); assert.equal(data.availableBalance, "82.43000000000000000000");
    const order = await db.paymentOrder.findUniqueOrThrow({ where: { id: aliOrder!.id } }); assert(order.paidAt && order.settledAt && order.providerTransactionId);
    const ledger = await db.walletTransaction.findUniqueOrThrow({ where: { paymentOrderId: order.id } }); assert.equal(ledger.type, "RECHARGE"); assert.equal(ledger.amount.toFixed(2), "50.00"); assert.equal(ledger.balanceBefore.toFixed(2), "32.43"); assert.equal(ledger.balanceAfter.toFixed(2), "82.43");
    const billing = await api<BillingData>("/api/dashboard/billing", a); assert.equal(billing.availableBalance, data.availableBalance); assert.equal(billing.recharges[0].status, "PAID"); assert.equal(billing.transactions[0].type, "RECHARGE"); assert.equal(billing.monthSpend, "0.00000000000000000000"); assert.equal(billing.lifetimeSpend, "0.00000000000000000000");
    const overview = await api<{ availableBalance: string }>("/api/dashboard/overview", a); assert.equal(overview.availableBalance, data.availableBalance);
    await api(`/api/payments/${order.id}/refresh`, a, 200, mutation({})); // Settled orders return before any external query.
  });
  await check("WeChat success credits exact integer-fen CNY and preserves reserved balance", async () => {
    await db.wallet.update({ where: { userId: b.id }, data: { reservedBalance: "0.12345678901234567890" } });
    assert.equal((await wxCallback(wxOrder!)).status, 204); assert.equal((await wallet(b)).balance.toFixed(2), "101.01");
    const data = await api<PaymentStatusData>(statusPath(wxOrder!), b); assert.equal(data.reservedBalance, "0.12345678901234567890"); assert.equal(data.availableBalance, "100.88654321098765432110");
  });
  await check("Duplicate callbacks across processes plus signed query and polling credit exactly once", async () => {
    const u = await owner("1"), order = await createPaymentOrder(u.id, { method: "ALIPAY", amount: "50" }, randomUUID(), alipay!.adapter);
    platformStates.get(order.orderNo)!.status = "PAID";
    const results = await Promise.all([reconcileOwnedPayment(u.id, order.id, alipay!.adapter), ...Array.from({ length: 20 }, (_, index) => callback(order, index % 2)), ...Array.from({ length: 8 }, () => api(statusPath(order), u))]);
    assert(results.every((result) => !(result instanceof Response) || result.status === 200));
    assert.equal((await wallet(u)).balance.toFixed(2), "51.00"); assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: order.id } }), 1);
    assert.equal((await api<PaymentStatusData>(statusPath(order), u)).order.status, "PAID");
    assert.equal((await callback(order, 0, { trade_no: "conflicting-id" })).status, 409); // No second credit even for conflicting signed notifications.
    assert.equal((await wallet(u)).balance.toFixed(2), "51.00");
  });
  await check("Concurrent WeChat callbacks and signed query share the same idempotent settlement", async () => {
    const u = await owner("0"), order = await createPaymentOrder(u.id, { method: "WECHAT", amount: "10" }, randomUUID(), localWechat); platformStates.get(order.orderNo)!.status = "PAID";
    const responses = await Promise.all([reconcileOwnedPayment(u.id, order.id, localWechat), ...Array.from({ length: 12 }, (_, index) => wxCallback(order, {}, {}, index % 2))]);
    assert(responses.every((result) => !(result instanceof Response) || result.status === 204)); assert.equal((await wallet(u)).balance.toFixed(2), "10.00"); assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: order.id } }), 1);
  });
  await check("Expired orders close, hide QR, cannot be reused and require a fresh attempt", async () => {
    const order = await rawOrder(a, "ALIPAY", { expiresAt: new Date(Date.now() - 1000) });
    const data = await api<PaymentStatusData>(statusPath(order), a); assert.equal(data.order.status, "CLOSED"); assert.equal(data.qrCodeDataUrl, null);
    await expectHttp(createPaymentOrder(a.id, { method: "ALIPAY", amount: "5" }, order.idempotencyKey, alipay!.adapter), 409);
    const fresh = await createPaymentOrder(a.id, { method: "ALIPAY", amount: "5" }, randomUUID(), alipay!.adapter); assert.notEqual(fresh.id, order.id); assert.notEqual(fresh.orderNo, order.orderNo); assert.equal(fresh.status, "PENDING");
    const body = await (await request(`/dashboard/billing/payments/${order.id}`, a)).text(); assert(body.includes("Payment expired") && body.includes("Create new payment"));
    await assert.rejects(db.paymentOrder.update({ where: { id: order.id }, data: { status: "PENDING" } }));
  });
  await check("Delayed authenticated success may settle a locally expired order once, never reopen it", async () => {
    const u = await owner(), order = await rawOrder(u, "ALIPAY", { expiresAt: new Date(Date.now() - 1000) }); await api(statusPath(order), u);
    const receipt = await alipay!.adapter.verifyNotification(new Request("https://payments.example.test", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: alipayNotification(order, { trade_status: "WAIT_BUYER_PAY" }) }));
    assert.equal((await applyVerifiedPayment(receipt)).status, "CLOSED");
    assert.equal((await callback(order)).status, 200); assert.equal((await callback(order, 1)).status, 200);
    assert.equal((await wallet(u)).balance.toFixed(2), "37.43"); assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: order.id } }), 1);
  });
  await check("Signed query failures and provider creation failures never credit or fake success", async () => {
    const u = await owner(), order = await createPaymentOrder(u.id, { method: "ALIPAY", amount: "5" }, randomUUID(), alipay!.adapter); platformStates.get(order.orderNo)!.badSignature = true;
    await assert.rejects(reconcileOwnedPayment(u.id, order.id, alipay!.adapter), PaymentProviderError);
    const wx = await createPaymentOrder(u.id, { method: "WECHAT", amount: "5" }, randomUUID(), localWechat); platformStates.get(wx.orderNo)!.badSignature = true;
    await assert.rejects(reconcileOwnedPayment(u.id, wx.id, localWechat), PaymentProviderError);
    const broken: PaymentProvider = { identity: alipay!.adapter.identity, create: async () => { throw new PaymentProviderError(); }, query: () => assert.fail(), close: () => assert.fail(), verifyNotification: () => assert.fail() };
    const failed = await createPaymentOrder(u.id, { method: "ALIPAY", amount: "5" }, randomUUID(), broken); assert.equal(failed.status, "FAILED"); assert.equal(failed.qrCodeDataUrl, null);
    assert.equal((await wallet(u)).balance.toFixed(2), "32.43"); assert.equal(await db.walletTransaction.count({ where: { walletId: u.walletId } }), 0);
  });
  await check("Expired signed Pending queries close the platform order without reopening local state", async () => {
    const u = await owner(), order = await rawOrder(u, "WECHAT", { expiresAt: new Date(Date.now() - 1000) }); platformStates.set(order.orderNo, { amount: order.amount.toFixed(2), status: "PENDING" });
    const before = platformCalls.close; await reconcileOwnedPayment(u.id, order.id, localWechat); assert.equal(platformCalls.close, before + 1); assert.equal(platformStates.get(order.orderNo)?.status, "CLOSED");
    assert.equal((await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "CLOSED"); assert.equal((await wallet(u)).balance.toFixed(2), "32.43");
  });
  await check("Original amount/owner are immutable and a reused provider transaction rolls back all writes", async () => {
    await assert.rejects(db.paymentOrder.update({ where: { id: aliOrder!.id }, data: { amount: "51" } })); await assert.rejects(db.paymentOrder.update({ where: { id: aliOrder!.id }, data: { userId: b.id } }));
    const u = await owner(), order = await rawOrder(u), before = (await wallet(u)).balance.toFixed(20), transaction = (await db.paymentOrder.findUniqueOrThrow({ where: { id: aliOrder!.id } })).providerTransactionId!;
    assert.equal((await callback(order, 0, { trade_no: transaction })).status, 503);
    assert.equal((await wallet(u)).balance.toFixed(20), before); assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: order.id } }), 0); assert.equal((await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING");
  });
  await check("Database commit guards reject Paid without a ledger and an unrelated owner's recharge ledger", async () => {
    const order = await rawOrder(a);
    await assert.rejects(db.paymentOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date(), settledAt: new Date(), providerTransactionId: `GUARD${seed}` } }));
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.walletTransaction.create({ data: { walletId: b.walletId, type: "RECHARGE", amount: order.amount, balanceBefore: "1", balanceAfter: "6", paymentOrderId: order.id, description: "Rejected fixture" } });
      await tx.paymentOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date(), settledAt: new Date(), providerTransactionId: `GUARD${seed}` } });
    }));
    assert.equal(await db.walletTransaction.count({ where: { paymentOrderId: order.id } }), 0);
  });
  await check("Recharge and transaction histories are owned, independently paginated and bounded", async () => {
    const u = await owner(), time = new Date();
    for (let i = 0; i < 31; i++) await rawOrder(u, i % 2 ? "WECHAT" : "ALIPAY", { createdAt: time });
    const expected = await db.paymentOrder.findMany({ where: { userId: u.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const ids: string[] = [];
    for (let page = 1; page <= 4; page++) { const data = await api<RechargeHistoryData>(`/api/payments?page=${page}&pageSize=10`, u); assert.equal(data.pagination.total, 31); assert(data.recharges.length <= 10); ids.push(...data.recharges.map((row) => row.id)); }
    assert.deepEqual(ids, expected.map((row) => row.id)); assert.equal(new Set(ids).size, 31);
    const billing = await api<BillingData>("/api/dashboard/billing?page=2&rechargePage=2&pageSize=10", u); assert.equal(billing.pagination.page, 1); assert.equal(billing.rechargePagination.page, 2); assert.equal(billing.recharges.length, 10);
    const emptyHistory = await api<RechargeHistoryData>("/api/payments", empty); assert.equal(emptyHistory.recharges.length, 0); assert.equal(emptyHistory.pagination.total, 0);
    for (const invalid of ["page=0", "pageSize=10000", "page=1&page=2", "rechargePage=2", `walletId=${a.walletId}`]) await api("/api/payments?" + invalid, u, 400);
    const indexes = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'PaymentOrder'`;
    for (const name of ["PaymentOrder_userId_createdAt_id_idx", "PaymentOrder_userId_status_expiresAt_idx", "PaymentOrder_method_providerTransactionId_key"]) assert(indexes.some((row) => row.indexname === name));
  });
  await check("Owned checkout and Billing SSR show refreshed real success and recharge history", async () => {
    const success = await (await request(`/dashboard/billing/payments/${aliOrder!.id}`, a)).text(); assert(success.includes("Payment successful") && success.includes("Back to Billing") && success.includes("View Transactions") && success.includes("82.43")); boundary(success);
    const pending = await rawOrder(a); const waiting = await (await request(`/dashboard/billing/payments/${pending.id}`, a)).text(); assert(waiting.includes("Waiting for payment") && waiting.includes("Refresh status"));
    const billing = await (await request("/dashboard/billing", a, {}, 2)).text(); assert(billing.includes("Recharge History") && billing.includes("Balance After") && billing.includes(aliOrder!.orderNo)); assert(!billing.includes(wxOrder!.orderNo)); assert(billing.includes("Payment methods are currently unavailable"));
  });
  console.log(`Payment integration checks: ${passed} passed (isolated PostgreSQL, signed local fixtures; no real payment or refund).`);
}
async function run() {
  try { await main(); } catch (error) {
    console.error(`FAIL ${activeCheck}. No credentials, signatures or raw provider contents were printed.`);
    if (error instanceof assert.AssertionError) console.error(`Assertion: actual=${typeof error.actual === "number" ? error.actual : "[non-numeric]"}, expected=${typeof error.expected === "number" ? error.expected : "[non-numeric]"}`);
    else if (error && typeof error === "object" && "code" in error && /^P\d{4}$/.test(String(error.code))) console.error(`Database error: ${error.code}`);
    else if (error instanceof Error) console.error(`Error class: ${error.constructor.name}`);
    process.exitCode = 1;
  } finally {
    for (const child of children) if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    if (alipay) await new Promise<void>((resolve) => alipay!.server.close(() => resolve()));
    await db.user.deleteMany({ where: { id: { in: owners.map((u) => u.id) }, email: { startsWith: `payments-${seed}-` } } }).catch(() => { console.error("Payment fixture cleanup failed."); process.exitCode = 1; });
    await risk.cleanup();
    await db.$disconnect(); await getDb().$disconnect();
    assert(keyDirectory.startsWith(workRoot + sep) && keyDirectory.endsWith(`payment-fixture-${seed}`)); rmSync(keyDirectory, { recursive: true, force: true });
  }
}
void run().catch(() => { console.error("Payment test cleanup failed."); process.exitCode = 1; });
