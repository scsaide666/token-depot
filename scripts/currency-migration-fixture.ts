import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

// Replay the old schema and the one-time conversion inside an isolated test schema.
// Real development data and the test database's public schema are never modified.
export async function verifyCurrencyMigration(databaseUrl: string) {
  const url = new URL(databaseUrl);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/aihub_auth_test");
  const schema = `currency_fixture_${randomBytes(8).toString("hex")}`;
  assert(/^currency_fixture_[a-f0-9]{16}$/.test(schema));
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const directory = resolve("prisma/migrations");
    for (const entry of readdirSync(directory).filter((name) => /^20261006/.test(name) && name < "20261006110000").sort()) {
      await client.query(readFileSync(resolve(directory, entry, "migration.sql"), "utf8"));
    }
    const userId = randomUUID(), walletId = randomUUID(), modelId = randomUUID(), requestId = randomUUID();
    await client.query(`INSERT INTO "User" (id,name,email,"passwordHash","updatedAt") VALUES ($1,'Migration fixture','migration@example.test','not-a-login',now())`, [userId]);
    await client.query(`INSERT INTO "Wallet" (id,"userId",balance,"reservedBalance","updatedAt") VALUES ($1,$2,25.70999999999999999999,0.000375,now())`, [walletId, userId]);
    await client.query(`INSERT INTO "Model" (id,slug,name,provider,"providerModel",description,"contextWindow","inputPricePerMillion","outputPricePerMillion","markupMultiplier","updatedAt") VALUES ($1,'migration','Migration','OPENAI','not-invoked','Fixture',10000,0.00000001,0,0.000001,now())`, [modelId]);
    await client.query(`INSERT INTO "ApiRequest" (id,"requestId","userId","modelId",provider,"inputTokens","outputTokens","totalTokens",status,"latencyMs","modelSlug","inputPricePerMillion","outputPricePerMillion","markupMultiplier","estimatedInputTokens","maxOutputTokens","modelContextWindow","reservationExpiresAt","reservedAmount","providerCost","userCost","settledAt")
      VALUES ($1,$2,$3,$4,'OPENAI',1,0,1,'SUCCESS',100,'migration',0.00000001,0,0.000001,1,1,10000,now(),0.00000000000000000001,0.00000000000001,0.00000000000000000001,now())`, [randomUUID(), requestId, userId, modelId]);
    await client.query(`INSERT INTO "WalletTransaction" (id,"walletId",amount,"balanceBefore","balanceAfter","requestId",model,description) VALUES ($1,$2,-0.00000000000000000001,25.71,25.70999999999999999999,$3,'migration','One-token fixture')`, [randomUUID(), walletId, requestId]);
    await client.query(`INSERT INTO "ApiRequest" (id,"requestId","userId","modelId",provider,status,"latencyMs","modelSlug","inputPricePerMillion","outputPricePerMillion","markupMultiplier","estimatedInputTokens","maxOutputTokens","modelContextWindow","reservationExpiresAt","reservedAmount")
      VALUES ($1,$2,$3,$4,'OPENAI','PENDING',0,'migration',1.25,2.5,1.2,50,100,10000,now()+interval '1 hour',0.000375)`, [randomUUID(), randomUUID(), userId, modelId]);
    const migration = readFileSync(resolve(directory, "20261006110000_cny_currency/migration.sql"), "utf8");
    await client.query(migration);
    const snapshot = async () => ({
      wallet: (await client.query(`SELECT balance::text,"reservedBalance"::text FROM "Wallet"`)).rows[0],
      model: (await client.query(`SELECT "inputPricePerMillion"::text,"outputPricePerMillion"::text,"markupMultiplier"::text FROM "Model"`)).rows[0],
      requests: (await client.query(`SELECT status,"inputPricePerMillion"::text,"outputPricePerMillion"::text,"providerCost"::text,"userCost"::text,"reservedAmount"::text,"totalTokens","markupMultiplier"::text FROM "ApiRequest" ORDER BY status`)).rows,
      ledger: (await client.query(`SELECT amount::text,"balanceBefore"::text,"balanceAfter"::text FROM "WalletTransaction"`)).rows[0],
    });
    const converted = await snapshot();
    assert.equal(converted.wallet.balance, "179.96999999999999999993");
    assert.equal(converted.wallet.reservedBalance, "0.00262500000000000000");
    assert.equal(converted.model.inputPricePerMillion, "0.00000007");
    assert.equal(converted.model.markupMultiplier, "0.000001");
    const tiny = converted.requests.find((row) => row.status === "SUCCESS")!, pending = converted.requests.find((row) => row.status === "PENDING")!;
    assert.equal(tiny.userCost, "0.00000000000000000007"); assert.equal(tiny.providerCost, "0.00000000000007000000"); assert.equal(tiny.totalTokens, 1);
    assert.equal(pending.inputPricePerMillion, "8.75000000"); assert.equal(pending.outputPricePerMillion, "17.50000000"); assert.equal(pending.reservedAmount, "0.00262500000000000000");
    assert.equal(converted.ledger.amount, "-0.00000000000000000007"); assert.equal(converted.ledger.balanceBefore, "179.97000000000000000000"); assert.equal(converted.ledger.balanceAfter, converted.wallet.balance);
    const audit = (await client.query(`SELECT "fromCurrency","toCurrency",rate::text FROM "CurrencyMigration"`)).rows[0];
    assert.deepEqual(audit, { fromCurrency: "USD", toCurrency: "CNY", rate: "7.0000" });
    await assert.rejects(client.query(migration));
    await client.query("ROLLBACK");
    assert.deepEqual(await snapshot(), converted, "Reapplying the same conversion must not multiply amounts twice.");
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}
