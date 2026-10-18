import { riskTestEnvironment } from "./risk-test-environment";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Model } from "../generated/prisma/client";
import { calculateCosts, money } from "../lib/billing/money";
import { estimateBudget } from "../lib/billing/budget";
import { recoverExpiredReservations, reserveRequest, settleFailure, settleSuccess } from "../lib/billing/wallet";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { hashPassword } from "../lib/server/password";
import { getDb } from "../lib/server/db";
import type { ChatCompletionInput, TokenUsage } from "../lib/ai/types";

config({ quiet: true });
const risk = riskTestEnvironment("billing");
Object.assign(process.env, risk.env);
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl || databaseUrl === process.env.DATABASE_URL) throw new Error("An isolated test database is required.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test");
process.env.DATABASE_URL = databaseUrl;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 6 }), log: [] });
const origins = ["http://127.0.0.1:3108", "http://127.0.0.1:3109"], fixtureOrigin = "http://127.0.0.1:3110";
const seed = randomBytes(8).toString("hex"), upstreamKey = `billing-fixture-${randomBytes(24).toString("hex")}`;
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production", OPENAI_API_KEY: upstreamKey, OPENAI_BASE_URL: `${fixtureOrigin}/v1`, OPENAI_TIMEOUT_MS: "20000", GATEWAY_REQUESTS_PER_MINUTE: "1000", GATEWAY_DEFAULT_MAX_OUTPUT_TOKENS: "32" };
const userIds: string[] = [], modelIds: string[] = [], servers: ChildProcess[] = [];
let passed = 0, activeCheck = "startup", callCount = 0, heldReplies: (() => void)[] = [];
type Fixture = { usage: TokenUsage; fail?: boolean; hold?: boolean };
const fixtures = new Map<string, Fixture>();
const fixtureServer = createServer(async (request, response) => {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string; max_completion_tokens?: number; max_tokens?: number };
  callCount++; const mode = fixtures.get(body.model); assert(mode, "Unknown isolated upstream fixture.");
  assert.equal(request.headers.authorization, `Bearer ${upstreamKey}`);
  const reply = () => {
    if (response.destroyed) return;
    if (mode.fail) { response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "Fixture provider failure" } })); return; }
    send(response, mode.usage);
  };
  if (mode.hold) heldReplies.push(reply); else reply();
});
function send(response: ServerResponse, usage: TokenUsage) {
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
    usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens },
  }));
}
function releaseReplies() { const replies = heldReplies; heldReplies = []; replies.forEach((reply) => reply()); }
type Identity = { userId: string; apiKeyId: string; key: string };
const tokenUsage = (inputTokens: number, outputTokens: number): TokenUsage => ({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens });
async function user(balance = "10"): Promise<Identity> {
  const email = `billing-${seed}-${userIds.length}@example.test`;
  const created = await db.user.create({ data: { email, name: "Billing fixture", passwordHash: await hashPassword(`Fixture-${randomBytes(24).toString("hex")}`), wallet: { create: { balance } } } }); userIds.push(created.id);
  const secret = generateApiKey(); const key = await db.apiKey.create({ data: { userId: created.id, name: "Billing fixture", keyHash: secret.keyHash, keyPrefix: secret.keyPrefix } });
  return { userId: created.id, apiKeyId: key.id, key: secret.key };
}
async function model(usage = tokenUsage(12, 7), prices: { input?: string; output?: string; markup?: string } = {}, mode: { fail?: boolean; hold?: boolean } = {}): Promise<Model> {
  const id = `billing-${seed}-${modelIds.length}`;
  const result = await db.model.create({ data: { slug: id, name: "Billing fixture", provider: "OPENAI", providerModel: id, description: "Isolated billing fixture", contextWindow: 4000000, inputPricePerMillion: prices.input ?? "0.12345678", outputPricePerMillion: prices.output ?? "9.87654321", markupMultiplier: prices.markup ?? "1.234567", enabled: true } });
  modelIds.push(result.id); fixtures.set(id, { usage, ...mode }); await risk.bindRouting(db, result, env); return result;
}
function input(model: Model, maxOutput = 50): ChatCompletionInput { return { model: model.slug, messages: [{ role: "user", content: "Hello" }], max_completion_tokens: maxOutput }; }
async function wallet(identity: Identity) { return db.wallet.findUniqueOrThrow({ where: { userId: identity.userId } }); }
async function chat(identity: Identity, m: Model, body = input(m), index = 0) {
  const response = await fetch(`${origins[index]}/v1/chat/completions`, { method: "POST", signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${identity.key}` }, body: JSON.stringify(body) });
  const requestId = response.headers.get("x-request-id"); assert(requestId);
  const json = await response.json() as { error?: { code: string }; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
  return { status: response.status, requestId, body: json };
}
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); passed++; console.log(`PASS ${name}`); }
// Independent BigInt arithmetic oracle, including the smallest supported 10^-20 CNY.
function scaled(value: string, scale: number) {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(value); assert(match);
  const fraction = match[2] ?? "", exponent = Number(match[3] ?? "0");
  const zeroes = scale - fraction.length + exponent; assert(zeroes >= 0);
  return BigInt(match[1] + fraction + "0".repeat(zeroes));
}
function fixed(value: bigint) { const digits = value.toString().padStart(21, "0"); return `${digits.slice(0, -20)}.${digits.slice(-20)}`; }
function oracle(inTokens: number, outTokens: number, inPrice: string, outPrice: string, markup: string) {
  const providerUnits = (BigInt(inTokens) * scaled(inPrice, 8) + BigInt(outTokens) * scaled(outPrice, 8)) * BigInt(1000000);
  return { providerCost: fixed(providerUnits), userCost: fixed(providerUnits * scaled(markup, 6) / BigInt(1000000)) };
}
async function verifySuccess(identity: Identity, requestId: string, prices: { inputPricePerMillion: { toString(): string }; outputPricePerMillion: { toString(): string }; markupMultiplier: { toString(): string } }) {
  const record = await db.apiRequest.findUniqueOrThrow({ where: { requestId } }); assert.equal(record.status, "SUCCESS"); assert(record.settledAt);
  const expected = oracle(record.inputTokens!, record.outputTokens!, prices.inputPricePerMillion.toString(), prices.outputPricePerMillion.toString(), prices.markupMultiplier.toString());
  assert.equal(record.providerCost?.toFixed(20), expected.providerCost); assert.equal(record.userCost?.toFixed(20), expected.userCost);
  const entry = await db.walletTransaction.findUniqueOrThrow({ where: { requestId } }); assert.equal(entry.type, "USAGE"); assert.equal(entry.walletId, (await wallet(identity)).id); assert.equal(entry.amount.toFixed(20), money(expected.userCost).negated().toFixed(20)); assert.equal(money(entry.balanceBefore).plus(money(entry.amount)).toFixed(20), entry.balanceAfter.toFixed(20));
  return record;
}

async function main() {
  activeCheck = "startup: test ports";
  for (const origin of [...origins, fixtureOrigin]) assert(await fetch(origin, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Billing test ports must be free.");
  activeCheck = "startup: isolated database migration";
  try { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" }); } catch { throw new Error("Isolated billing migration failed."); }
  activeCheck = "startup: Mock Provider";
  fixtureServer.listen(3110, "127.0.0.1"); await once(fixtureServer, "listening");
  for (let index = 0; index < origins.length; index++) {
    activeCheck = `startup: Next.js test server ${index + 1}`;
    const handle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(3108 + index)], { env: { ...env, APP_ORIGIN: origins[index] }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); servers.push(handle);
    handle.stdout?.on("data", () => {}); handle.stderr?.on("data", () => {}); let startupError = false, lastStatus = 0; handle.on("error", () => { startupError = true; }); const deadline = Date.now() + 30000;
    while (!await fetch(`${origins[index]}/api/auth/session`, { signal: AbortSignal.timeout(1000) }).then((response) => { lastStatus = response.status; return response.status === 200; }).catch(() => false)) {
      if (startupError || handle.exitCode !== null || Date.now() > deadline) throw new Error(`Billing test server startup failed (HTTP ${lastStatus}, process ${handle.exitCode === null ? "running" : "exited"}).`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await check("Input, output, one token, one million tokens and extreme prices retain exact Decimal precision", async () => {
    for (const [inTokens, outTokens, inPrice, outPrice, markup] of [
      [1, 0, "0.12345678", "9.87654321", "1.234567"], [0, 1, "0.12345678", "9.87654321", "1.234567"],
      [1000000, 1000000, "2", "3", "1.5"], [1, 0, "0.00000001", "0", "0.000001"],
      [2147483647, 0, "999999999999.99999999", "0", "999999.999999"],
    ] as const) assert.deepEqual(calculateCosts(inTokens, outTokens, { inputPricePerMillion: inPrice, outputPricePerMillion: outPrice, markupMultiplier: markup }), oracle(inTokens, outTokens, inPrice, outPrice, markup));
  });
  await check("Sufficient balance reserves before dispatch and settles a reconciled usage ledger", async () => {
    const u = await user("10"), m = await model(), before = callCount;
    const output = await chat(u, m); assert.equal(output.status, 200); assert.equal(callCount, before + 1);
    const record = await verifySuccess(u, output.requestId, m); const balance = await wallet(u);
    assert.equal(balance.balance.toFixed(20), money("10").minus(money(record.userCost!)).toFixed(20)); assert.equal(balance.reservedBalance.toFixed(), "0"); assert(record.reservedAmount.gt(record.userCost!));
  });
  await check("Insufficient and already-reserved balance return 402 without dispatch or ledger", async () => {
    for (const initial of ["0", "0.00000000000000000001"]) {
      const u = await user(initial), m = await model(), before = callCount; const output = await chat(u, m);
      assert.equal(output.status, 402); assert.equal(output.body.error?.code, "insufficient_balance"); assert.equal(callCount, before);
      const record = await db.apiRequest.findUniqueOrThrow({ where: { requestId: output.requestId } }); assert.equal(record.status, "FAILED"); assert.equal(record.reservedAmount.toFixed(), "0"); assert.equal(await db.walletTransaction.count({ where: { requestId: output.requestId } }), 0); assert.equal((await wallet(u)).reservedBalance.toFixed(), "0"); assert.equal((await db.apiKey.findUniqueOrThrow({ where: { id: u.apiKeyId } })).lastUsedAt, null);
    }
    const u = await user("1"), m = await model(tokenUsage(0, 1), { input: "0", output: "10000", markup: "1" });
    const firstId = randomUUID(); await reserveRequest(firstId, u, m, input(m, 100));
    const before = callCount; assert.equal((await chat(u, m, input(m, 1))).status, 402); assert.equal(callCount, before);
    assert.equal((await wallet(u)).reservedBalance.toFixed(), "1"); await settleFailure(u.userId, firstId, "provider_error", 1);
  });
  await check("A zero-balance wallet can use a free model and still records an exact zero-cost ledger", async () => {
    const u = await user("0"), m = await model(tokenUsage(12, 7), { input: "0", output: "0", markup: "1" });
    const output = await chat(u, m); assert.equal(output.status, 200);
    const record = await verifySuccess(u, output.requestId, m), balance = await wallet(u);
    assert.equal(record.reservedAmount.toFixed(20), "0.00000000000000000000");
    assert.equal(record.userCost?.toFixed(20), "0.00000000000000000000");
    assert.equal(balance.balance.toFixed(20), "0.00000000000000000000");
    assert.equal(balance.reservedBalance.toFixed(20), "0.00000000000000000000");
    assert.equal(await db.walletTransaction.count({ where: { requestId: output.requestId } }), 1);
  });
  await check("One-token input and output charges are distinct; tiny prices persist down to 10^-20", async () => {
    for (const usage of [tokenUsage(1, 0), tokenUsage(0, 1)]) {
      const u = await user("1"), m = await model(usage); const output = await chat(u, m, input(m, 1)); assert.equal(output.status, 200); await verifySuccess(u, output.requestId, m);
    }
    const u = await user("0.00000000000000000100"), m = await model(tokenUsage(1, 0), { input: "0.00000001", output: "0", markup: "0.000001" });
    const output = await chat(u, m, input(m, 1)); assert.equal(output.status, 200); const record = await verifySuccess(u, output.requestId, m);
    assert.equal(record.userCost?.toFixed(20), "0.00000000000000000001"); assert.equal((await wallet(u)).balance.toFixed(20), "0.00000000000000000099");
  });
  await check("A million input/output tokens settle using the exact formula and markup", async () => {
    const u = await user("20"), m = await model(tokenUsage(1000000, 1000000), { input: "2", output: "3", markup: "1.5" });
    const body: ChatCompletionInput = { model: m.slug, messages: [{ role: "user", content: "a".repeat(500000) }, { role: "user", content: "b".repeat(500000) }], max_tokens: 1000000 };
    // Verify large Decimal settlement independently of the Gateway's hard input caps.
    const requestId = randomUUID(); await reserveRequest(requestId, u, m, body);
    await settleSuccess(u.userId, requestId, tokenUsage(1000000, 1000000), 1);
    const record = await verifySuccess(u, requestId, m); assert.equal(record.providerCost?.toFixed(), "5"); assert.equal(record.userCost?.toFixed(), "7.5"); assert.equal((await wallet(u)).balance.toFixed(), "12.5");
  });
  await check("Provider failure releases its hold without a final charge or ledger", async () => {
    const u = await user("1"), m = await model(tokenUsage(12, 7), {}, { fail: true });
    const output = await chat(u, m); assert.equal(output.status, 502); assert.equal(output.body.error?.code, "provider_unavailable");
    const balance = await wallet(u); assert.equal(balance.balance.toFixed(), "1"); assert.equal(balance.reservedBalance.toFixed(), "0");
    const record = await db.apiRequest.findUniqueOrThrow({ where: { requestId: output.requestId } }); assert.equal(record.status, "FAILED"); assert(record.settledAt); assert.equal(record.userCost?.toFixed(), "0"); assert.equal(await db.walletTransaction.count({ where: { requestId: output.requestId } }), 0);
  });
  await check("A Pending record, exact hold and immutable price snapshot exist before the upstream finishes", async () => {
    const u = await user("10"), m = await model(tokenUsage(12, 7), {}, { hold: true }); const response = chat(u, m);
    const deadline = Date.now() + 10000; while (!heldReplies.length) { assert(Date.now() < deadline); await new Promise((resolve) => setTimeout(resolve, 20)); }
    const pending = await db.apiRequest.findFirstOrThrow({ where: { userId: u.userId, status: "PENDING" } }); const balance = await wallet(u);
    assert.equal(balance.balance.toFixed(), "10"); assert.equal(balance.reservedBalance.toFixed(20), pending.reservedAmount.toFixed(20)); assert.equal(pending.providerCost, null); assert.equal(pending.userCost, null); assert.equal(pending.settledAt, null);
    await db.model.update({ where: { id: m.id }, data: { slug: `${m.slug}-edited`, inputPricePerMillion: "100", outputPricePerMillion: "200", markupMultiplier: "99" } });
    releaseReplies(); const output = await response; assert.equal(output.status, 200); await verifySuccess(u, output.requestId, m);
    assert.equal((await db.walletTransaction.findUniqueOrThrow({ where: { requestId: output.requestId } })).model, m.slug);
  });
  await check("Duplicate and concurrent settlements charge once and retain the original terminal result", async () => {
    const u = await user("1"), m = await model(tokenUsage(0, 10), { input: "0", output: "10000", markup: "1" }), id = randomUUID();
    await reserveRequest(id, u, m, input(m, 50));
    await assert.rejects(reserveRequest(id, u, m, input(m, 50)));
    await Promise.all(Array.from({ length: 10 }, () => settleSuccess(u.userId, id, tokenUsage(0, 10), 1)));
    await settleSuccess(u.userId, id, tokenUsage(0, 20), 2); const lateFailure = await settleFailure(u.userId, id, "provider_error", 3);
    assert.equal(lateFailure.status, "SUCCESS"); assert.equal(lateFailure.outputTokens, 10); assert.equal((await wallet(u)).balance.toFixed(), "0.9"); assert.equal((await wallet(u)).reservedBalance.toFixed(), "0"); assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 1);
  });
  for (const count of [10, 100]) await check(`${count} concurrent HTTP requests across two app processes cannot over-reserve or overdraw ¥1`, async () => {
    const u = await user("1"), m = await model(tokenUsage(0, 10), { input: "0", output: "10000", markup: "1" }, { hold: true });
    let rejected = 0; const responses = Array.from({ length: count }, (_, index) => chat(u, m, input(m, 50), index % 2).then((output) => { if (output.status !== 200) rejected++; return output; }));
    const deadline = Date.now() + 15000;
    while (heldReplies.length + rejected < count) { assert(Date.now() < deadline, "Concurrent reservation test timed out."); await new Promise((resolve) => setTimeout(resolve, 20)); }
    assert.equal(heldReplies.length, 2); assert.equal(rejected, count - 2);
    const held = await wallet(u); assert.equal(held.balance.toFixed(), "1"); assert.equal(held.reservedBalance.toFixed(), "1"); assert.equal(await db.apiRequest.count({ where: { userId: u.userId, status: "PENDING" } }), 2);
    releaseReplies(); const outputs = await Promise.all(responses); assert.equal(outputs.filter((output) => output.status === 200).length, 2); assert.equal(outputs.filter((output) => output.status === 402 && output.body.error?.code === "insufficient_balance").length, count - 2); assert.equal(new Set(outputs.map((output) => output.requestId)).size, count);
    const balance = await wallet(u); assert.equal(balance.balance.toFixed(), "0.8"); assert.equal(balance.reservedBalance.toFixed(), "0"); assert(balance.balance.gte(0)); assert.equal(await db.walletTransaction.count({ where: { walletId: balance.id } }), 2);
  });
  await check("Underestimated upstream usage cannot consume another request's frozen funds", async () => {
    const u = await user("1"), m = await model(tokenUsage(140, 0), { input: "5000", output: "0", markup: "1" });
    const ids = [randomUUID(), randomUUID()]; for (const id of ids) await reserveRequest(id, u, m, input(m, 1));
    const failed = await settleSuccess(u.userId, ids[0], tokenUsage(140, 0), 1); assert.equal(failed.status, "FAILED"); assert.equal(failed.errorCode, "billing_limit_exceeded"); assert.equal(failed.userCost?.toFixed(), "0");
    assert.equal((await wallet(u)).balance.toFixed(), "1"); assert.equal((await wallet(u)).reservedBalance.toFixed(20), (await db.apiRequest.findUniqueOrThrow({ where: { requestId: ids[1] } })).reservedAmount.toFixed(20));
    const success = await settleSuccess(u.userId, ids[1], tokenUsage(100, 0), 1); assert.equal(success.status, "SUCCESS"); assert.equal((await wallet(u)).balance.toFixed(), "0.5");
  });
  await check("The output budget is transmitted and provider budget overruns fail without a debit", async () => {
    const u = await user("1"), m = await model(tokenUsage(0, 51), { input: "0", output: "10000", markup: "1" });
    const output = await chat(u, m, input(m, 50)); assert.equal(output.status, 500); assert.equal(output.body.error?.code, "provider_usage_exceeded"); assert.equal((await wallet(u)).balance.toFixed(), "1"); assert.equal((await wallet(u)).reservedBalance.toFixed(), "0");
    const bounded = estimateBudget({ model: m.slug, messages: [{ role: "user", content: "Hello" }] }, m); assert.equal(bounded.boundedInput.max_completion_tokens, bounded.maxOutputTokens); assert(bounded.maxOutputTokens > 0);
  });
  await check("Settlement owner checks prevent one user from changing another user's hold or balance", async () => {
    const a = await user("1"), b = await user("1"), m = await model(), id = randomUUID(); await reserveRequest(id, a, m, input(m));
    await assert.rejects(settleSuccess(b.userId, id, tokenUsage(12, 7), 1)); await assert.rejects(settleFailure(b.userId, id, "provider_error", 1));
    assert.equal((await wallet(a)).balance.toFixed(), "1"); assert.equal((await wallet(b)).balance.toFixed(), "1"); assert.equal((await wallet(b)).reservedBalance.toFixed(), "0"); await settleFailure(a.userId, id, "provider_error", 1);
  });
  await check("A failed ledger write rolls back the entire settlement and an idempotent retry succeeds", async () => {
    const u = await user("1"), m = await model(tokenUsage(0, 10), { input: "0", output: "10000", markup: "1" }), id = randomUUID(); await reserveRequest(id, u, m, input(m, 50));
    const before = await wallet(u);
    // Trusted test-only conflicting ledger row injects a unique-constraint failure.
    await db.walletTransaction.create({ data: { walletId: before.id, requestId: id, amount: "0", balanceBefore: "1", balanceAfter: "1", model: m.slug, description: "Temporary rollback fixture" } });
    await assert.rejects(settleSuccess(u.userId, id, tokenUsage(0, 10), 1));
    const unchanged = await wallet(u); assert.equal(unchanged.balance.toFixed(20), before.balance.toFixed(20)); assert.equal(unchanged.reservedBalance.toFixed(20), before.reservedBalance.toFixed(20)); assert.equal((await db.apiRequest.findUniqueOrThrow({ where: { requestId: id } })).status, "PENDING");
    await db.walletTransaction.delete({ where: { requestId: id } }); await settleSuccess(u.userId, id, tokenUsage(0, 10), 1); assert.equal((await wallet(u)).balance.toFixed(), "0.9");
  });
  await check("Expired holds recover once; late success or failure cannot revive or debit them", async () => {
    const u = await user("1"), m = await model(tokenUsage(0, 10), { input: "0", output: "10000", markup: "1" }), id = randomUUID(); await reserveRequest(id, u, m, input(m, 50));
    await db.apiRequest.update({ where: { requestId: id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await recoverExpiredReservations(u.userId); await recoverExpiredReservations(u.userId); assert.equal((await wallet(u)).reservedBalance.toFixed(), "0");
    const late = await settleSuccess(u.userId, id, tokenUsage(0, 10), 1); assert.equal(late.status, "FAILED"); assert.equal(late.errorCode, "reservation_expired"); await settleFailure(u.userId, id, "provider_error", 1); assert.equal((await wallet(u)).balance.toFixed(), "1"); assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 0);
  });
  await check("Deleting an in-flight API key preserves price snapshots and permits safe settlement", async () => {
    const u = await user("1"), m = await model(tokenUsage(0, 10), { input: "0", output: "10000", markup: "1" }, { hold: true }), response = chat(u, m, input(m, 50));
    const deadline = Date.now() + 10000; while (!heldReplies.length) { assert(Date.now() < deadline); await new Promise((resolve) => setTimeout(resolve, 20)); }
    await db.apiKey.delete({ where: { id: u.apiKeyId } }); releaseReplies(); const output = await response; assert.equal(output.status, 200); assert.equal((await db.apiRequest.findUniqueOrThrow({ where: { requestId: output.requestId } })).apiKeyId, null); assert.equal((await wallet(u)).balance.toFixed(), "0.9");
  });
  await check("Database constraints enforce nonnegative finite balances, exact ledgers and Decimal(50,20)", async () => {
    const u = await user("1"), w = await wallet(u);
    for (const patch of [{ balance: "-0.00000000000000000001" }, { reservedBalance: "1.00000000000000000001" }, { balance: "NaN" }, { reservedBalance: "NaN" }]) await assert.rejects(db.wallet.update({ where: { id: w.id }, data: patch }));
    const columns = await db.$queryRaw<{ table_name: string; column_name: string; data_type: string; numeric_precision: number; numeric_scale: number }[]>`SELECT table_name, column_name, data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE (table_name = 'Wallet' AND column_name IN ('balance', 'reservedBalance')) OR (table_name = 'WalletTransaction' AND column_name IN ('amount', 'balanceBefore', 'balanceAfter')) OR (table_name = 'ApiRequest' AND column_name IN ('providerCost', 'userCost', 'reservedAmount'))`;
    assert.equal(columns.length, 8); for (const column of columns) { assert.equal(column.data_type, "numeric"); assert.equal(column.numeric_precision, 50); assert.equal(column.numeric_scale, 20); }
    for (const id of userIds) { const w = await db.wallet.findUniqueOrThrow({ where: { userId: id } }); assert(w.balance.gte(0)); assert(w.reservedBalance.gte(0)); assert(w.reservedBalance.lte(w.balance)); }
  });
  console.log(`Billing integration checks: ${passed} passed (isolated database and local HTTP fixture).`);
}
async function run() {
  try { await main(); } catch (error) {
    console.error(`FAIL ${activeCheck}. No credentials, prompts or raw responses were printed.`);
    if (error instanceof assert.AssertionError) {
      const numeric = (value: unknown) => typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) ? value : "[non-numeric assertion]";
      console.error(`Assertion: actual=${numeric(error.actual)}, expected=${numeric(error.expected)}`);
    } else if (error && typeof error === "object" && "code" in error && /^P\d{4}$/.test(String(error.code))) console.error(`Database error: ${error.code}`);
    else if (error instanceof Error) console.error(`Error class: ${error.constructor.name}; ${error.message.startsWith("Billing test server startup failed") ? error.message : "details withheld"}`);
    process.exitCode = 1;
  }
  finally {
    releaseReplies();
    for (const server of servers) if (server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    if (fixtureServer.listening) { fixtureServer.closeAllConnections(); await new Promise<void>((resolve) => fixtureServer.close(() => resolve())); }
    await db.user.deleteMany({ where: { id: { in: userIds }, email: { startsWith: `billing-${seed}-` } } }).catch(() => { console.error("Billing user cleanup failed."); process.exitCode = 1; });
    await db.model.deleteMany({ where: { id: { in: modelIds } } }).catch(() => { console.error("Billing model cleanup failed."); process.exitCode = 1; });
    await risk.cleanup();
    await risk.cleanupRouting(db);
    await db.$disconnect(); await getDb().$disconnect();
  }
}
void run().catch(() => { console.error("Billing cleanup failed."); process.exitCode = 1; });
