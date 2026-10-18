import { readFileSync, unlinkSync } from "node:fs";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
config({ quiet: true });
async function main() {
  const fixture = JSON.parse(readFileSync("../../work/playground-ui-fixture.json", "utf8"));
  const url = process.env.DATABASE_URL_TEST;
  if (!url || new URL(url).pathname !== "/aihub_auth_test" || !["127.0.0.1", "localhost"].includes(new URL(url).hostname) || !fixture.email.startsWith("playground-")) throw new Error("Not an isolated test fixture");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (process.argv.includes("--cleanup")) {
      const seed = /^playground-([0-9a-f]{12})-\d+@example\.test$/.exec(fixture.email)?.[1];
      if (!seed) throw new Error("Invalid fixture identity");
      const models = await db.model.findMany({ where: { slug: { startsWith: `playground-${seed}-` } }, select: { id: true, channels: { select: { channelId: true } } } });
      await db.user.deleteMany({ where: { email: { startsWith: `playground-${seed}-`, endsWith: "@example.test" } } });
      await db.model.deleteMany({ where: { id: { in: models.map(model => model.id) } } });
      await db.providerChannel.deleteMany({ where: { id: { in: models.flatMap(model => model.channels.map(channel => channel.channelId)) }, code: { startsWith: "fixture-playground-" }, models: { none: {} }, attempts: { none: {} } } });
      unlinkSync("../../work/playground-ui-fixture.json");
      console.log("Interrupted disposable UI fixture cleaned up in the isolated database."); return;
    }
    const user = await db.user.findUniqueOrThrow({ where: { email: fixture.email }, include: { wallet: true } });
    if (!user.wallet.reservedBalance.isZero()) throw new Error("Test request still active");
    await db.wallet.update({ where: { userId: user.id }, data: { balance: "0" } });
    console.log("Isolated UI test wallet is now empty for the 402 check.");
  } finally { await db.$disconnect(); }
}
void main().catch(error => { console.error(JSON.stringify({ event: "isolated_wallet_setup_failed", kind: error.name, code: /^P\d+$/.test(error.code ?? "") ? error.code : undefined, activeRequest: error.message === "Test request still active" })); process.exitCode = 1; });
