BEGIN;
ALTER TABLE "WalletTransaction"
  ADD COLUMN "adminId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "adjustmentId" UUID,
  ADD COLUMN "reason" VARCHAR(200);
CREATE UNIQUE INDEX "WalletTransaction_adminId_adjustmentId_key" ON "WalletTransaction"("adminId", "adjustmentId");
CREATE INDEX "WalletTransaction_adminId_createdAt_idx" ON "WalletTransaction"("adminId", "createdAt");
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_entry_check";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_entry_check" CHECK (
  "balanceBefore" >= 0 AND "balanceAfter" >= 0 AND "balanceAfter" = "balanceBefore" + "amount"
  AND "amount" <> 'NaN'::numeric AND "balanceBefore" <> 'NaN'::numeric AND "balanceAfter" <> 'NaN'::numeric
  AND (
    ("type" = 'USAGE' AND "amount" <= 0 AND "requestId" IS NOT NULL AND "model" IS NOT NULL AND "paymentOrderId" IS NULL AND "adminId" IS NULL AND "adjustmentId" IS NULL AND "reason" IS NULL)
    OR ("type" = 'RECHARGE' AND "amount" > 0 AND "requestId" IS NULL AND "model" IS NULL AND "paymentOrderId" IS NOT NULL AND "adminId" IS NULL AND "adjustmentId" IS NULL AND "reason" IS NULL)
    OR ("type" = 'ADMIN_ADJUSTMENT' AND "amount" <> 0 AND "requestId" IS NULL AND "model" IS NULL AND "paymentOrderId" IS NULL AND "adminId" IS NOT NULL AND "adjustmentId" IS NOT NULL AND length(btrim("reason")) BETWEEN 3 AND 200)
  )
);
CREATE FUNCTION protect_admin_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."type" = 'ADMIN_ADJUSTMENT' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Administrator adjustment audit records are immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."type" = 'ADMIN_ADJUSTMENT' THEN
    PERFORM id FROM "User" WHERE id = NEW."adminId" AND role = 'ADMIN' AND status = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'An adjustment requires an active administrator'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WalletTransaction_admin_audit" BEFORE INSERT OR UPDATE ON "WalletTransaction"
  FOR EACH ROW EXECUTE FUNCTION protect_admin_adjustment();
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt",id);
CREATE INDEX "User_status_createdAt_id_idx" ON "User"(status,"createdAt",id);
CREATE INDEX "ApiRequest_createdAt_id_idx" ON "ApiRequest"("createdAt",id);
CREATE INDEX "ApiRequest_status_createdAt_id_idx" ON "ApiRequest"(status,"createdAt",id);
CREATE INDEX "ApiRequest_provider_createdAt_id_idx" ON "ApiRequest"(provider,"createdAt",id);
CREATE INDEX "PaymentOrder_createdAt_id_idx" ON "PaymentOrder"("createdAt",id);
CREATE INDEX "PaymentOrder_status_createdAt_id_idx" ON "PaymentOrder"(status,"createdAt",id);
CREATE INDEX "PaymentOrder_method_status_createdAt_id_idx" ON "PaymentOrder"(method,status,"createdAt",id);
-- Trusted extension: supports bounded, case-insensitive name/email substring search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "User_name_search_idx" ON "User" USING GIN (name gin_trgm_ops);
CREATE INDEX "User_email_search_idx" ON "User" USING GIN (email gin_trgm_ops);
COMMIT;
