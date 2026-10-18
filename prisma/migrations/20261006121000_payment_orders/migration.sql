BEGIN;
CREATE TABLE "PaymentOrder" (
  "id" UUID NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "orderNo" VARCHAR(32) NOT NULL UNIQUE,
  "idempotencyKey" UUID NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" NUMERIC(20,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
  "merchantId" VARCHAR(64) NOT NULL,
  "appId" VARCHAR(64) NOT NULL,
  "codeUrl" VARCHAR(2048),
  "qrCodeDataUrl" TEXT,
  "providerTransactionId" VARCHAR(128),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "paidAt" TIMESTAMPTZ(3),
  "settledAt" TIMESTAMPTZ(3),
  "closedAt" TIMESTAMPTZ(3),
  "lastCheckedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PaymentOrder_amount_check" CHECK (
    "currency" = 'CNY' AND "amount" >= 1 AND "amount" <= 10000 AND "amount" <> 'NaN'::numeric
  ),
  CONSTRAINT "PaymentOrder_settlement_check" CHECK (
    ("status" IN ('PAID', 'REFUNDED') AND "paidAt" IS NOT NULL AND "settledAt" IS NOT NULL AND "providerTransactionId" IS NOT NULL)
    OR ("status" IN ('PENDING', 'FAILED', 'CLOSED') AND "settledAt" IS NULL AND "paidAt" IS NULL AND "providerTransactionId" IS NULL)
  )
);
CREATE UNIQUE INDEX "PaymentOrder_userId_idempotencyKey_key" ON "PaymentOrder"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "PaymentOrder_method_providerTransactionId_key" ON "PaymentOrder"("method", "providerTransactionId");
CREATE INDEX "PaymentOrder_userId_createdAt_id_idx" ON "PaymentOrder"("userId", "createdAt", "id");
CREATE INDEX "PaymentOrder_userId_status_expiresAt_idx" ON "PaymentOrder"("userId", "status", "expiresAt");
CREATE INDEX "PaymentOrder_status_expiresAt_idx" ON "PaymentOrder"("status", "expiresAt");

ALTER TABLE "WalletTransaction"
  ALTER COLUMN "requestId" DROP NOT NULL,
  ALTER COLUMN "model" DROP NOT NULL,
  ADD COLUMN "paymentOrderId" UUID REFERENCES "PaymentOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "WalletTransaction_paymentOrderId_key" ON "WalletTransaction"("paymentOrderId");
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_usage_check";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_entry_check" CHECK (
  "balanceBefore" >= 0 AND "balanceAfter" >= 0 AND "balanceAfter" = "balanceBefore" + "amount"
  AND "amount" <> 'NaN'::numeric AND "balanceBefore" <> 'NaN'::numeric AND "balanceAfter" <> 'NaN'::numeric
  AND (
    ("type" = 'USAGE' AND "amount" <= 0 AND "requestId" IS NOT NULL AND "model" IS NOT NULL AND "paymentOrderId" IS NULL)
    OR ("type" = 'RECHARGE' AND "amount" > 0 AND "requestId" IS NULL AND "model" IS NULL AND "paymentOrderId" IS NOT NULL)
  )
);

CREATE FUNCTION protect_payment_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."userId", NEW."orderNo", NEW."idempotencyKey", NEW."method", NEW."amount", NEW."currency", NEW."merchantId", NEW."appId", NEW."expiresAt")
    IS DISTINCT FROM (OLD."userId", OLD."orderNo", OLD."idempotencyKey", OLD."method", OLD."amount", OLD."currency", OLD."merchantId", OLD."appId", OLD."expiresAt") THEN
    RAISE EXCEPTION 'Payment order identity and financial terms are immutable';
  END IF;
  IF OLD."status" <> 'PENDING' AND NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION 'A terminal order cannot return to Pending';
  END IF;
  IF OLD."settledAt" IS NOT NULL AND (NEW."status", NEW."paidAt", NEW."settledAt", NEW."providerTransactionId")
    IS DISTINCT FROM (OLD."status", OLD."paidAt", OLD."settledAt", OLD."providerTransactionId") THEN
    RAISE EXCEPTION 'A settled payment cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PaymentOrder_protect" BEFORE UPDATE ON "PaymentOrder" FOR EACH ROW EXECUTE FUNCTION protect_payment_order();

-- Cross-table check runs at commit, after the wallet, ledger and order are written together.
CREATE FUNCTION check_payment_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_id uuid; entry record; payment record;
BEGIN
  IF TG_TABLE_NAME = 'PaymentOrder' THEN payment_id := NEW."id";
  ELSE payment_id := NEW."paymentOrderId"; END IF;
  IF payment_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO payment FROM "PaymentOrder" WHERE "id" = payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT t.*, w."userId" AS owner INTO entry FROM "WalletTransaction" t
    JOIN "Wallet" w ON w."id" = t."walletId" WHERE t."paymentOrderId" = payment_id;
  IF payment."status" IN ('PAID','REFUNDED') THEN
    IF entry."id" IS NULL OR entry."type" <> 'RECHARGE' OR entry.owner <> payment."userId" OR entry."amount" <> payment."amount" THEN
      RAISE EXCEPTION 'A paid order requires its unique matching owned recharge ledger';
    END IF;
  ELSIF entry."id" IS NOT NULL THEN
    RAISE EXCEPTION 'An unpaid order cannot have a recharge ledger';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "PaymentOrder_ledger_check" AFTER INSERT OR UPDATE ON "PaymentOrder"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_ledger();
CREATE CONSTRAINT TRIGGER "WalletTransaction_payment_check" AFTER INSERT OR UPDATE ON "WalletTransaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_ledger();
COMMIT;
