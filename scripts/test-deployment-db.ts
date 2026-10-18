import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
config({ quiet: true });
const url = process.env.DATABASE_URL_TEST;
assert(url && new URL(url).pathname === "/aihub_auth_test" && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
assert(url !== process.env.DATABASE_URL);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] });
async function main() {
const seed = randomUUID();
const providers = ["OPENAI", "ANTHROPIC", "GOOGLE", "DEEPSEEK"] as const;
const ids: string[] = [];
const channels: string[] = [];
const previousModels = await db.model.findMany({ where: { provider: { not: "DEEPSEEK" }, enabled: true }, select: { id: true } });
const previousChannels = await db.providerChannel.findMany({ where: { provider: { not: "DEEPSEEK" }, enabled: true }, select: { id: true } });
const run = (apply = false) => JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "deploy/restrict-mainland.ts", ...(apply ? ["--apply"] : [])], {
  env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", windowsHide: true
}));
try {
  for (const provider of providers) {
    const model = await db.model.create({ data: { slug: `deploy-${provider.toLowerCase()}-${seed}`, name: "Deployment fixture", provider,
      providerModel: "fixture", description: "Isolated local fixture", contextWindow: 1000, inputPricePerMillion: "1.23456789", outputPricePerMillion: "2", markupMultiplier: "1.2", enabled: true } });
    ids.push(model.id);
    const channel = await db.providerChannel.create({ data: { code: `deploy-${provider}-${seed}`, name: "Deployment fixture", provider, apiKeyEnv: "UNCONFIGURED", baseUrlEnv: "UNCONFIGURED", enabled: true } });
    channels.push(channel.id);
  }
  assert.equal(run().mode, "preview");
  assert.equal(await db.model.count({ where: { id: { in: ids }, enabled: true } }), 4);
  console.log("PASS mainland restriction preview leaves models unchanged");
  run(true);
  const models = await db.model.findMany({ where: { id: { in: ids } } });
  for (const model of models) {
    assert.equal(model.enabled, model.provider === "DEEPSEEK");
    assert.equal(model.inputPricePerMillion.toString(), "1.23456789");
  }
  console.log("PASS mainland restriction disables overseas models, preserves DeepSeek and Decimal prices");
  const routes = await db.providerChannel.findMany({ where: { id: { in: channels } } });
  for (const route of routes) assert.equal(route.enabled, route.provider === "DEEPSEEK");
  console.log("PASS mainland restriction disables overseas channels");
  const repeat = run(true);
  assert.equal(repeat.disabledModels, 0);
  assert.equal(repeat.disabledChannels, 0);
  console.log("PASS mainland restriction repeat is idempotent");
} finally {
  await db.model.deleteMany({ where: { id: { in: ids } } });
  await db.providerChannel.deleteMany({ where: { id: { in: channels } } });
  await db.model.updateMany({ where: { id: { in: previousModels.map(m=>m.id) } }, data: { enabled: true } });
  await db.providerChannel.updateMany({ where: { id: { in: previousChannels.map(c=>c.id) } }, data: { enabled: true } });
  await db.$disconnect();
}
}
void main().catch(() => { console.error("Deployment DB integration check failed; details suppressed."); process.exitCode = 1; });
