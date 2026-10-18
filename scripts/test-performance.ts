import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import { getDb } from "../lib/server/db";
import { gatewayModel } from "../lib/server/model-cache";
import { metadataCache } from "../lib/server/metadata-cache";
import { closeRiskRedis } from "../lib/risk/redis";
import { riskTestEnvironment } from "./risk-test-environment";
import { reserveRequest } from "../lib/billing/wallet";
config({ quiet: true });
const url = process.env.DATABASE_URL_TEST;
assert(url && url !== process.env.DATABASE_URL && new URL(url).pathname === "/aihub_auth_test" && new URL(url).hostname === "127.0.0.1");
const risk = riskTestEnvironment("metadata-cache");
Object.assign(process.env, risk.env, { DATABASE_URL: url });
const db = getDb(), id = randomUUID(), slug = `cache-${id}`;
const userId = randomUUID();
let passed = 0;
async function check(label: string, run: () => Promise<void>) { await run(); passed++; console.log(`PASS ${label}`); }
async function main() {
  await db.model.create({ data: { id, slug, name: "Cache fixture", provider: "DEEPSEEK", providerModel: "fixture", description: "local only", contextWindow: 4096,
    inputPricePerMillion: "0.12345678", outputPricePerMillion: "1.23456789", markupMultiplier: "1.123456" } });
  await check("cached model retains exact Decimal prices", async () => {
    const first = await gatewayModel(slug), second = await gatewayModel(slug);
    assert(first?.inputPricePerMillion.eq("0.12345678")); assert(second?.markupMultiplier.eq("1.123456"));
  });
  await check("concurrent metadata miss coalesces loader", async () => {
    let loads = 0;
    const rows = await Promise.all(Array.from({ length: 50 }, () => metadataCache(`fixture:${id}`, 1000, async () => { loads++; return { version: 1 }; })));
    assert.equal(loads, 1); assert(rows.every(row => row.version === 1));
  });
  await check("near cache expires and does not pin old metadata", async () => {
    let loads = 0;
    const load = async () => ({ value: ++loads });
    assert.equal((await metadataCache(`ttl:${id}`, 40, load)).value, 1);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal((await metadataCache(`ttl:${id}`, 40, load)).value, 2);
  });
  await check("price edit invalidates without waiting for TTL", async () => {
    await db.model.update({ where: { id }, data: { inputPricePerMillion: "2.87654321" } });
    assert((await gatewayModel(slug))?.inputPricePerMillion.eq("2.87654321"));
  });
  await check("direct SQL disable also invalidates cache", async () => {
    await db.$executeRaw`UPDATE "Model" SET enabled = false WHERE id = ${id}::uuid`;
    assert.equal((await gatewayModel(slug))?.enabled, false);
  });
  await check("operator sweep releases abandoned hold once without another user request", async () => {
    await db.user.create({ data: { id: userId, name: "Recovery fixture", email: `${userId}@example.test`, passwordHash: "disabled", wallet: { create: { balance: "1" } } } });
    const model = await db.model.findUniqueOrThrow({ where: { id } }), requestId = randomUUID();
    await reserveRequest(requestId, { userId, apiKeyId: null }, model, { model: slug, messages: [{ role: "user", content: "fixture" }], max_tokens: 1 });
    await db.apiRequest.update({ where: { requestId }, data: { reservationExpiresAt: new Date(Date.now() - 10000) } });
    for (let repeat = 0; repeat < 2; repeat++) execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/recover-reservations.ts"], { env: process.env, windowsHide: true, stdio: "pipe" });
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
    assert(wallet.balance.eq("1") && wallet.reservedBalance.isZero());
    assert.equal((await db.apiRequest.findUniqueOrThrow({ where: { requestId } })).status, "FAILED");
    assert.equal(await db.walletTransaction.count({ where: { requestId } }), 0);
  });
  await check("delete cannot return cached model", async () => {
    await db.model.delete({ where: { id } }); assert.equal(await gatewayModel(slug), null);
  });
  await check("metadata Redis outage falls back to database", async () => {
    await closeRiskRedis(); process.env.REDIS_URL = "redis://127.0.0.1:1/15";
    assert.equal(await gatewayModel(`${slug}-outage`), null);
  });
  console.log(`Performance regression: ${passed} passed.`);
}
main().catch(() => { console.error("Performance regression failed; details suppressed."); process.exitCode = 1; })
  .finally(async () => { await db.user.deleteMany({ where: { id: userId } }); await db.model.deleteMany({ where: { id } }); await db.$disconnect(); await closeRiskRedis(); await risk.cleanup(); });
