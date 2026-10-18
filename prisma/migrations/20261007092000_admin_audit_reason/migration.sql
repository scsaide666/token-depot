-- CHECK rejects NULL explicitly, rather than relying on SQL's three-valued length comparison.
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_admin_reason_check"
  CHECK ("type" <> 'ADMIN_ADJUSTMENT' OR "reason" IS NOT NULL);

-- An existing usage/recharge entry cannot be recast as an administrator adjustment.
CREATE OR REPLACE FUNCTION protect_admin_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."type" = 'ADMIN_ADJUSTMENT' OR NEW."type" = 'ADMIN_ADJUSTMENT') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Administrator adjustment audit records are immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."type" = 'ADMIN_ADJUSTMENT' THEN
    PERFORM id FROM "User" WHERE id = NEW."adminId" AND role = 'ADMIN' AND status = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'An adjustment requires an active administrator'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
