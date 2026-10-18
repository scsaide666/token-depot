import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { money } from "../lib/billing/money";
import { readSse } from "../lib/ai/providers/sse";
import { riskTestEnvironment } from "./risk-test-environment";
import type { PlaygroundStats } from "../lib/playground-types";

// Explicit opt-in: this makes one tiny live completion, separate from npm test.
if (!process.argv.includes("--live")) throw new Error("Use --live to authorize the live upstream smoke request.");
config({ path: ".env.local", quiet: true }); config({ quiet: true });
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl || databaseUrl === process.env.DATABASE_URL) throw new Error("An isolated test database is required.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test");
const deepseek = process.argv.includes("--deepseek");
const playground = process.argv.includes("--playground");
const streaming = playground || process.argv.includes("--stream"), risk = riskTestEnvironment("live-gateway");
const provider = deepseek ? "DEEPSEEK" : "OPENAI";
const providerModel = deepseek ? "deepseek-flash" : "gpt-4.1-mini";
assert(deepseek
  ? process.env.DEEPSEEK_API_KEY && (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com") === "https://api.deepseek.com"
  : process.env.OPENAI_API_KEY && (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1") === "https://api.openai.com/v1", "Configure the selected private upstream first.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 3 }), log: [] });
const origin = "http://127.0.0.1:3107", seed = randomBytes(8).toString("hex"), email = `gateway-live-${seed}@example.test`;
let userId: string | undefined, modelId: string | undefined, server: ChildProcess | undefined;
let stage = "startup";

async function main() {
  assert(await fetch(origin, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Live smoke port must be free.");
  const env: NodeJS.ProcessEnv = { ...process.env, ...risk.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, NODE_ENV: "production", PAYMENTS_ENABLED: "false", OPENAI_TIMEOUT_MS: "30000", DEEPSEEK_TIMEOUT_MS: "30000" };
  const handle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3107"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); server = handle;
  handle.stdout?.on("data", () => {}); handle.stderr?.on("data", () => {});
  let startupError = false; handle.on("error", () => { startupError = true; }); const deadline = Date.now() + 30000;
  while (!await fetch(`${origin}/api/auth/session`, { signal: AbortSignal.timeout(1000) }).then((response) => response.status === 200).catch(() => false)) { if (startupError || handle.exitCode !== null || Date.now() > deadline) throw new Error("startup_failed"); await new Promise((resolve) => setTimeout(resolve, 250)); }
  stage = "register fixture";
  const password = `Live-fixture-${randomBytes(20).toString("hex")}`;
  const register = await fetch(`${origin}/api/auth/register`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Live Gateway Fixture", email, password, confirmPassword: password }) });
  assert.equal(register.status, 201); const registration = await register.json() as { user: { id: string } }; userId = registration.user.id;
  await db.wallet.update({ where: { userId }, data: { balance: "1" } });
  const cookie = register.headers.getSetCookie().find((value) => value.startsWith("__Host-aihub-session="))?.split(";")[0]; assert(cookie);
  const createdKey = await fetch(`${origin}/api/api-keys`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ name: "Live smoke fixture" }) });
  assert.equal(createdKey.status, 201); const key = await createdKey.json() as { key: string; apiKey: { id: string } };
  const model = await db.model.create({ data: { slug: `live-smoke-${seed}`, name: "Live smoke fixture", provider, providerModel, description: "Temporary isolated live smoke fixture with test ledger pricing", contextWindow: deepseek ? 1000000 : 1047576, inputPricePerMillion: deepseek ? "2" : "0.4", outputPricePerMillion: deepseek ? "8" : "1.6", markupMultiplier: "1", enabled: true } }); modelId = model.id;
  await risk.bindRouting(db, model, env);
  stage = "live completion";
  const response = await fetch(`${origin}${playground ? "/api/playground" : "/v1/chat/completions"}`, { method: "POST", signal: AbortSignal.timeout(45000),
    headers: playground ? { Origin: origin, Cookie: cookie, "Content-Type": "application/json" } : { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.slug, messages: [{ role: "user", content: "Reply only: OK" }],
      ...(playground ? { submissionId: randomUUID(), max_tokens: 8 } : { max_completion_tokens: 8, stream: streaming, ...(streaming ? { stream_options: { include_usage: true } } : {}) }) }) });
  type Body = { model: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; choices?: unknown[]; error?: { code: string } };
  let body: Body;
  if (streaming && response.ok) {
    assert(response.headers.get("content-type")?.startsWith("text/event-stream"));
    let done = 0, content = false, finish = false; body = { model: model.slug };
    for await (const event of readSse(response, AbortSignal.timeout(45000))) {
      if (event.data === "[DONE]") { done++; continue; }
      assert.equal(done, 0);
      const frame = JSON.parse(event.data) as Body & { choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
      assert(!frame.error); assert.equal(frame.model, model.slug);
      if (frame.usage) body.usage = frame.usage;
      if (frame.choices?.[0]?.delta?.content) content = true;
      if (frame.choices?.[0]?.finish_reason) finish = true;
    }
    assert.equal(done, 1); assert(content && finish); body.choices = [{}];
  } else body = await response.json() as Body;
  const requestId = response.headers.get("x-request-id"); assert(requestId);
  const record = await db.apiRequest.findUniqueOrThrow({ where: { requestId } });
  const lastUsedUpdated = Boolean((await db.apiKey.findUniqueOrThrow({ where: { id: key.apiKey.id } })).lastUsedAt);
  assert.equal(lastUsedUpdated, !playground);
  assert.equal(record.source, playground ? "PLAYGROUND" : "API");
  assert.equal(record.apiKeyId, playground ? null : key.apiKey.id);
  if (response.status !== 200) {
    const allowedCodes = ["provider_unavailable", "provider_auth_error", "provider_rate_limit", "provider_timeout", "provider_not_configured", "invalid_request", "context_length_exceeded", "rate_limit_exceeded", "gateway_error", "billing_unavailable", "insufficient_balance", "billing_limit_exceeded", "provider_usage_exceeded"];
    console.log(JSON.stringify({ provider, playground, liveGatewayStatus: response.status, errorCode: allowedCodes.includes(body.error?.code ?? "") ? body.error?.code : "unknown", requestLogged: record.status === "FAILED", lastUsedUpdated }));
    throw new Error("live_upstream_failed");
  }
  stage = "persisted usage";
  assert.equal(body.model, model.slug); assert(body.choices?.length); assert(body.usage);
  assert.equal(record.status, "SUCCESS"); assert.equal(record.inputTokens, body.usage.prompt_tokens); assert.equal(record.outputTokens, body.usage.completion_tokens); assert.equal(record.totalTokens, body.usage.total_tokens); assert.equal(record.inputTokens! + record.outputTokens!, record.totalTokens);
  const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } }); assert(record.userCost); assert.equal(wallet.balance.toFixed(20), money("1").minus(money(record.userCost)).toFixed(20)); assert.equal(wallet.reservedBalance.toFixed(), "0");
  const entry = await db.walletTransaction.findUniqueOrThrow({ where: { requestId } }); assert.equal(entry.amount.toFixed(20), money(record.userCost).negated().toFixed(20));
  assert.equal(await db.walletTransaction.count({ where: { requestId } }), 1);
  if (playground) {
    stage = "owned Playground statistics";
    const statistics = await fetch(`${origin}/api/playground/runs/${requestId}`, { headers: { Cookie: cookie } }); assert.equal(statistics.status, 200);
    const stats = await statistics.json() as PlaygroundStats;
    assert.equal(stats.status, "SUCCESS"); assert.equal(stats.inputTokens, record.inputTokens); assert.equal(stats.outputTokens, record.outputTokens); assert.equal(stats.totalTokens, record.totalTokens);
    assert.equal(stats.actualCost, record.userCost.toFixed()); assert.equal(stats.availableBalance, money(wallet.balance).toFixed()); assert.equal(stats.currency, "CNY");
  }
  console.log(JSON.stringify({ liveGatewayStatus: 200, providerModel, streaming, playground, inputTokens: record.inputTokens, outputTokens: record.outputTokens, totalTokens: record.totalTokens, userCost: record.userCost.toFixed(20), requestLogged: true, lastUsedUpdated, billingSettled: true }));
}
async function run() {
  try { await main(); } catch { console.error(`Live gateway smoke failed during ${stage}; no secret or raw provider response was printed.`); process.exitCode = 1; }
  finally {
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    if (userId) await db.user.deleteMany({ where: { id: userId, email } }).catch(() => { console.error("Live user cleanup failed."); process.exitCode = 1; });
    if (modelId) await db.model.deleteMany({ where: { id: modelId } }).catch(() => { console.error("Live model cleanup failed."); process.exitCode = 1; });
    await risk.cleanupRouting(db); await risk.cleanup();
    const keys = ["register", "login"].map((action) => createHash("sha256").update(`${action}:${email}`).digest("hex"));
    await db.authRateLimit.deleteMany({ where: { key: { in: keys } } }).catch(() => { console.error("Live rate-limit cleanup failed."); process.exitCode = 1; });
    await db.$disconnect();
  }
}
void run().catch(() => { console.error("Live cleanup failed."); process.exitCode = 1; });
