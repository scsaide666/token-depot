import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import { Client } from "pg";
import { money } from "../lib/billing/money";

config({ quiet: true });
async function snapshot(client: Client) {
  const values: Record<string, string> = {};
  for (const [table, fields] of Object.entries({ Wallet: ["balance", "reservedBalance"], Model: ["inputPricePerMillion", "outputPricePerMillion"], ApiRequest: ["providerCost", "userCost", "reservedAmount", "inputPricePerMillion", "outputPricePerMillion"], WalletTransaction: ["amount", "balanceBefore", "balanceAfter"] })) {
    for (const field of fields) { const result = await client.query(`SELECT COALESCE(SUM("${field}"), 0)::text AS value FROM "${table}"`); values[`${table}.${field}`] = result.rows[0].value; }
  }
  return values;
}
async function migrate(name: "DATABASE_URL" | "DATABASE_URL_TEST") {
  const url = process.env[name]; if (!url) throw new Error("Local database configuration is required.");
  const parsed = new URL(url);
  assert(["127.0.0.1", "localhost"].includes(parsed.hostname) && ["/aihub", "/aihub_auth_test"].includes(parsed.pathname));
  const client = new Client({ connectionString: url }); await client.connect();
  try {
    const existing = (await client.query(`SELECT to_regclass('"CurrencyMigration"') AS table_name`)).rows[0].table_name;
    const before = await snapshot(client);
    try { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", windowsHide: true }); }
    catch { throw new Error("Local migration failed. No connection details were printed."); }
    const after = await snapshot(client);
    for (const [field, value] of Object.entries(before)) assert(money(after[field]).eq(money(value).times(existing ? "1" : "7")), "Currency conversion reconciliation failed.");
    const conversion = (await client.query(`SELECT "fromCurrency", "toCurrency", rate::text FROM "CurrencyMigration" WHERE id = '20261006-usd-cny'`)).rows[0];
    assert.equal(conversion.fromCurrency, "USD"); assert.equal(conversion.toCurrency, "CNY"); assert(money(conversion.rate).eq("7"));
    const invalid = (await client.query(`SELECT count(*)::int AS count FROM "Wallet" WHERE balance < 0 OR "reservedBalance" < 0 OR "reservedBalance" > balance`)).rows[0].count;
    assert.equal(invalid, 0);
    console.log(`${name === "DATABASE_URL" ? "Development" : "Isolated test"} database: migrations applied; ${existing ? "existing CNY data unchanged" : "all monetary aggregates reconciled at USD × 7"}; wallet invariants valid.`);
  } finally { await client.end(); }
}
async function main() { await migrate("DATABASE_URL"); await migrate("DATABASE_URL_TEST"); }
main().catch(() => { console.error("Currency migration verification failed. No financial records or credentials were printed."); process.exitCode = 1; });
