import { getDb } from "../lib/server/db";

// Trusted operator command, not a public API. Never enables a model or changes prices.
const db = getDb();
async function main() {
  const where = { provider: { in: ["OPENAI", "ANTHROPIC", "GOOGLE"] as ("OPENAI" | "ANTHROPIC" | "GOOGLE")[] }, enabled: true };
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ mode: "preview", models: await db.model.count({ where }), channels: await db.providerChannel.count({ where }) }));
    return;
  }
  const result = await db.$transaction(async (tx) => {
    const models = await tx.model.updateMany({ where, data: { enabled: false } });
    const channels = await tx.providerChannel.updateMany({ where, data: { enabled: false } });
    // Uses the shared DB revision so all existing caches become stale.
    await tx.modelCacheRevision.upsert({ where: { id: 1 }, create: { id: 1, revision: 1 }, update: { revision: { increment: 1 } } });
    return { disabledModels: models.count, disabledChannels: channels.count };
  });
  console.log(JSON.stringify(result));
}
main().catch(() => { console.error("Mainland provider restriction failed; details suppressed."); process.exitCode = 1; })
  .finally(() => db.$disconnect());
