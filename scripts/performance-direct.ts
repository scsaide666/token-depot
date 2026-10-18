import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import { handleChatCompletion } from "../lib/ai/gateway";
import { getDb } from "../lib/server/db";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { closeRiskRedis } from "../lib/risk/redis";
import { riskTestEnvironment } from "./risk-test-environment";

// Supplementary core concurrency test. No HTTP listener acceptance bottleneck:
// invokes the real Gateway handler, DB/Redis/routing and local upstream directly.
// This is NOT a 500-connection server capacity result and does not replace HTTP load.
config({ quiet: true });
const url = process.env.DATABASE_URL_TEST;
assert(url && url !== process.env.DATABASE_URL && new URL(url).hostname === "127.0.0.1" && new URL(url).pathname === "/aihub_auth_test");
const risk = riskTestEnvironment("direct-500"), userId = randomUUID(), modelId = randomUUID();
const secret = generateApiKey(), fixtureKey = randomBytes(24).toString("hex"), slug = `performance-direct-${modelId}`;
Object.assign(process.env, risk.env, { DATABASE_URL: url, NODE_ENV: "production", OPENAI_API_KEY: fixtureKey, OPENAI_BASE_URL: "http://127.0.0.1:3195/v1",
  OPENAI_TIMEOUT_MS: "90000", GATEWAY_API_KEY_RPM: "100000", GATEWAY_API_KEY_CONCURRENCY: "1000", PERFORMANCE_PROVIDER_PORT: "3195", PERFORMANCE_PROVIDER_KEY: fixtureKey,
  ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", DEEPSEEK_API_KEY: "", UPSTREAM_API_KEY: "" });
const db = getDb();
let child: ReturnType<typeof spawn> | undefined;
async function main() {
  assert(await fetch("http://127.0.0.1:3195/health", { signal: AbortSignal.timeout(300) }).then(() => false).catch(() => true));
  child = spawn(process.execPath, ["scripts/performance-provider.mjs"], { env: process.env, windowsHide: true, stdio: "ignore" });
  const deadline = Date.now() + 15000;
  while (!await fetch("http://127.0.0.1:3195/health", { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false)) {
    assert(Date.now() < deadline && child.exitCode === null); await new Promise(resolve => setTimeout(resolve, 100));
  }
  await db.user.create({ data: { id: userId, name: "Core concurrency fixture", email: `${userId}@example.test`, passwordHash: "disabled", wallet: { create: { balance: "100" } } } });
  await db.apiKey.create({ data: { userId, name: "Core fixture", keyHash: secret.keyHash, keyPrefix: secret.keyPrefix } });
  const model = await db.model.create({ data: { id: modelId, slug, name: "Core fixture", provider: "OPENAI", providerModel: slug, description: "local only", contextWindow: 4096,
    inputPricePerMillion: "2", outputPricePerMillion: "8", markupMultiplier: "1.25" } });
  await risk.bindRouting(db, model, process.env);
  const began = performance.now();
  const results = await Promise.all(Array.from({ length: 500 }, async () => {
    const response = await handleChatCompletion(new Request("http://127.0.0.1/v1/chat/completions", { method: "POST", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${secret.key}` }, body: JSON.stringify({ model: slug, messages: [{ role: "user", content: "fixture" }], max_tokens: 32 }), signal: AbortSignal.timeout(120000) }));
    await response.arrayBuffer(); return response.status;
  }));
  const records = await db.apiRequest.count({ where: { userId, status: "SUCCESS", userCost: "0.0001", providerCost: "0.00008" } });
  const ledgerRows = await db.walletTransaction.count({ where: { wallet: { userId }, type: "USAGE", amount: "-0.0001" } });
  const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
  const pending = await db.apiRequest.count({ where: { userId, status: "PENDING" } });
  const passed = results.every(status => status === 200) && records === 500 && ledgerRows === 500 && pending === 0 && wallet.balance.eq("99.95") && wallet.reservedBalance.isZero();
  const summary = { test: "500 simultaneous same-wallet Gateway handler invocations", httpListenerBypassed: true,
    durationMs: performance.now() - began, statuses: Object.fromEntries([...new Set(results)].map(status => [status, results.filter(value => value === status).length])),
    exactSuccessfulRecords: records, exactUsageLedgers: ledgerRows, balance: wallet.balance.toFixed(), reservedBalance: wallet.reservedBalance.toFixed(), pending, passed };
  writeFileSync("../../work/performance/direct-500.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary)); assert(passed);
}
main().catch(() => { console.error("Direct concurrency verification failed; details suppressed."); process.exitCode = 1; })
  .finally(async () => {
    if (child && child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 3000))]); }
    await db.user.deleteMany({ where: { id: userId } }); await db.model.deleteMany({ where: { id: modelId } });
    await risk.cleanupRouting(db); await risk.cleanup(); await closeRiskRedis(); await db.$disconnect();
  });
