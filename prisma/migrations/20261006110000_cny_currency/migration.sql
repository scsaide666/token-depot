BEGIN;
-- Fixed conversion explicitly selected by the project owner: 1 USD = 7 CNY.
-- Lock admission/settlement while all balances, prices and historical snapshots move together.
LOCK TABLE "Wallet", "ApiKey", "ApiRequest", "WalletTransaction", "Model" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "Model"
  ALTER COLUMN "inputPricePerMillion" TYPE NUMERIC(22,8),
  ALTER COLUMN "outputPricePerMillion" TYPE NUMERIC(22,8);
ALTER TABLE "ApiRequest"
  ALTER COLUMN "inputPricePerMillion" TYPE NUMERIC(22,8),
  ALTER COLUMN "outputPricePerMillion" TYPE NUMERIC(22,8);

UPDATE "Wallet" SET "balance" = "balance" * 7, "reservedBalance" = "reservedBalance" * 7;
UPDATE "Model" SET "inputPricePerMillion" = "inputPricePerMillion" * 7,
  "outputPricePerMillion" = "outputPricePerMillion" * 7;
UPDATE "ApiRequest" SET
  "inputPricePerMillion" = "inputPricePerMillion" * 7,
  "outputPricePerMillion" = "outputPricePerMillion" * 7,
  "providerCost" = "providerCost" * 7, "userCost" = "userCost" * 7,
  "reservedAmount" = "reservedAmount" * 7;
UPDATE "WalletTransaction" SET "amount" = "amount" * 7,
  "balanceBefore" = "balanceBefore" * 7, "balanceAfter" = "balanceAfter" * 7;

CREATE TABLE "CurrencyMigration" (
  "id" VARCHAR(64) PRIMARY KEY,
  "fromCurrency" CHAR(3) NOT NULL,
  "toCurrency" CHAR(3) NOT NULL,
  "rate" NUMERIC(10,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "CurrencyMigration" ("id", "fromCurrency", "toCurrency", "rate")
  VALUES ('20261006-usd-cny', 'USD', 'CNY', 7);
COMMIT;
