import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import { getDb } from "../lib/server/db";
config({ quiet: true });
const url = process.env.DATABASE_URL_TEST;
assert(url && url !== process.env.DATABASE_URL && new URL(url).pathname === "/aihub_auth_test" && new URL(url).hostname === "127.0.0.1");
process.env.DATABASE_URL = url;
const db = getDb(), userId = randomUUID();
let stage = "user";
const query = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "userId" FROM "ApiRequest" WHERE status = 'PENDING' AND "reservationExpiresAt" <= NOW() GROUP BY "userId" ORDER BY MIN("reservationExpiresAt"), "userId" LIMIT 100`;
async function main() {
  await db.user.create({ data: { id: userId, name: "Query plan fixture", email: `${userId}@example.test`, passwordHash: "disabled", wallet: { create: {} } } });
  stage = "history";
  for (let batch = 0; batch < 40; batch++) await db.apiRequest.createMany({ data: Array.from({ length: 500 }, () => ({ requestId: randomUUID(), userId, status: "FAILED" as const, errorCode: "fixture", latencyMs: 0 })) });
  stage = "pending";
  await db.apiRequest.createMany({ data: Array.from({ length: 100 }, () => ({ requestId: randomUUID(), userId, status: "PENDING" as const, latencyMs: 0,
    modelSlug: "fixture", inputPricePerMillion: "0", outputPricePerMillion: "0", markupMultiplier: "1", estimatedInputTokens: 1,
    maxOutputTokens: 1, modelContextWindow: 100, reservationExpiresAt: new Date(Date.now() - 10000) })) });
  stage = "explain";
  await db.$executeRawUnsafe('ANALYZE "ApiRequest"');
  const before = await db.$queryRawUnsafe(query);
  let after: unknown;
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE INDEX "performance_recovery_probe_idx" ON "ApiRequest" ("status", "reservationExpiresAt", "userId")');
      after = await tx.$queryRawUnsafe(query);
      throw new Error("rollback_probe");
    });
  } catch (error) { if (!(error instanceof Error) || error.message !== "rollback_probe") throw error; }
  writeFileSync("../../work/performance/query-plans.json", JSON.stringify({ fixtureRows: 20100, before, after }, null, 2));
  console.log("Saved actual recovery EXPLAIN ANALYZE before/after; temporary index rolled back.");
}
main().catch(error => { console.error({ stage, code: typeof error?.code === "string" ? error.code : "unknown", message: "Query measurement failed; details suppressed." }); process.exitCode = 1; })
  .finally(async () => { await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect(); });
