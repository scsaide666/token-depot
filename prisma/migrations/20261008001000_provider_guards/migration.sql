ALTER TABLE "ProviderChannel" ADD CONSTRAINT "ProviderChannel_limits_check" CHECK (
  priority BETWEEN 0 AND 10000 AND weight BETWEEN 1 AND 1000 AND "timeoutMs" BETWEEN 100 AND 120000
  AND rpm BETWEEN 1 AND 1000000 AND tpm BETWEEN 1 AND 1000000000 AND concurrency BETWEEN 1 AND 1000
  AND "failureThreshold" BETWEEN 1 AND 1000 AND "cooldownMs" BETWEEN 100 AND 300000
  AND "consecutiveFailures" >= 0 AND "circuitVersion" >= 0
);
ALTER TABLE "ModelChannel" ADD CONSTRAINT "ModelChannel_price_check" CHECK (
  "contextWindow" > 0 AND "inputPricePerMillion" >= 0 AND "outputPricePerMillion" >= 0
  AND "inputPricePerMillion" <> 'NaN'::numeric AND "outputPricePerMillion" <> 'NaN'::numeric
);
CREATE UNIQUE INDEX "ModelChannel_one_preferred" ON "ModelChannel"("modelId") WHERE preferred;
ALTER TABLE "ProviderAttempt" ADD CONSTRAINT "ProviderAttempt_integrity" CHECK (
  "attemptNumber" BETWEEN 1 AND 3 AND "estimatedTokens" > 0 AND "latencyMs" >= 0
  AND "inputPricePerMillion" >= 0 AND "outputPricePerMillion" >= 0
  AND "inputPricePerMillion" <> 'NaN'::numeric AND "outputPricePerMillion" <> 'NaN'::numeric
  AND (("inputTokens" IS NULL AND "outputTokens" IS NULL AND "totalTokens" IS NULL) OR
    ("inputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL AND "totalTokens" IS NOT NULL
     AND "inputTokens" >= 0 AND "outputTokens" >= 0 AND "totalTokens" = "inputTokens"::bigint + "outputTokens"::bigint))
  AND (("costStatus" = 'PENDING_RECONCILIATION' AND "providerCost" IS NULL) OR
    ("costStatus" = 'NOT_INCURRED' AND "providerCost" IS NOT NULL AND "providerCost" = 0 AND "executionState" IN ('NOT_SENT','REJECTED')) OR
    ("costStatus" = 'KNOWN' AND "providerCost" IS NOT NULL AND "totalTokens" IS NOT NULL AND
      "providerCost" = ("inputTokens"::numeric * "inputPricePerMillion" + "outputTokens"::numeric * "outputPricePerMillion") / 1000000))
  AND (("status" = 'PENDING' AND "finishedAt" IS NULL AND "errorCode" IS NULL) OR
    ("status" = 'SUCCESS' AND "finishedAt" IS NOT NULL AND "errorCode" IS NULL AND "totalTokens" IS NOT NULL AND "costStatus" = 'KNOWN') OR
    ("status" = 'FAILED' AND "finishedAt" IS NOT NULL AND "errorCode" IS NOT NULL))
);

-- Sales snapshots and customer charges stay exact; provider costs are now independent.
ALTER TABLE "ApiRequest" DROP CONSTRAINT "ApiRequest_snapshot_check";
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_snapshot_check" CHECK (
  ("modelSlug" IS NULL AND "inputPricePerMillion" IS NULL AND "outputPricePerMillion" IS NULL AND "markupMultiplier" IS NULL
   AND "estimatedInputTokens" IS NULL AND "maxOutputTokens" IS NULL AND "modelContextWindow" IS NULL AND "reservationExpiresAt" IS NULL
   AND "reservedAmount" = 0 AND "providerCost" IS NULL AND "userCost" IS NULL AND "settledAt" IS NULL AND "status" <> 'PENDING')
  OR
  ("modelSlug" IS NOT NULL AND "inputPricePerMillion" IS NOT NULL AND "outputPricePerMillion" IS NOT NULL AND "markupMultiplier" IS NOT NULL
   AND "estimatedInputTokens" IS NOT NULL AND "maxOutputTokens" IS NOT NULL AND "modelContextWindow" IS NOT NULL AND "reservationExpiresAt" IS NOT NULL
   AND "inputPricePerMillion" >= 0 AND "outputPricePerMillion" >= 0 AND "markupMultiplier" > 0
   AND "inputPricePerMillion" <> 'NaN'::numeric AND "outputPricePerMillion" <> 'NaN'::numeric AND "markupMultiplier" <> 'NaN'::numeric
   AND "estimatedInputTokens" >= 0 AND "maxOutputTokens" > 0 AND "estimatedInputTokens"::bigint + "maxOutputTokens"::bigint <= "modelContextWindow"::bigint
   AND "reservedAmount" = ("estimatedInputTokens"::numeric * "inputPricePerMillion" + "maxOutputTokens"::numeric * "outputPricePerMillion") * 0.000001 * "markupMultiplier"
   AND (
     ("status" = 'PENDING' AND "settledAt" IS NULL AND "providerCost" IS NULL AND "userCost" IS NULL)
     OR ("status" = 'SUCCESS' AND "settledAt" IS NOT NULL AND "userCost" IS NOT NULL AND
       "userCost" = ("inputTokens"::numeric * "inputPricePerMillion" + "outputTokens"::numeric * "outputPricePerMillion") * 0.000001 * "markupMultiplier"
       AND ("providerCost" IS NOT NULL OR ("providerCostStatus" IS NOT NULL AND "providerCostStatus" = 'PENDING_RECONCILIATION')))
     OR ("status" = 'FAILED' AND "settledAt" IS NOT NULL AND "userCost" = 0)
   ))
);

CREATE FUNCTION preserve_provider_attempt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."requestId",NEW."channelId",NEW."executionGroup",NEW.provider,NEW."providerModel",NEW."inputPricePerMillion",NEW."outputPricePerMillion",NEW."attemptNumber")
    IS DISTINCT FROM ROW(OLD."requestId",OLD."channelId",OLD."executionGroup",OLD.provider,OLD."providerModel",OLD."inputPricePerMillion",OLD."outputPricePerMillion",OLD."attemptNumber")
 THEN RAISE EXCEPTION 'Provider attempt snapshots are immutable'; END IF;
 IF OLD.status <> 'PENDING' AND (NEW.status <> OLD.status OR NEW."errorCode" IS DISTINCT FROM OLD."errorCode" OR NEW."finishedAt" IS DISTINCT FROM OLD."finishedAt")
 THEN RAISE EXCEPTION 'Terminal provider attempts cannot be replayed'; END IF;
 IF OLD.status <> 'PENDING' AND OLD."costStatus" <> 'PENDING_RECONCILIATION' AND
    ROW(NEW."costStatus",NEW."providerCost",NEW."inputTokens",NEW."outputTokens",NEW."totalTokens")
      IS DISTINCT FROM ROW(OLD."costStatus",OLD."providerCost",OLD."inputTokens",OLD."outputTokens",OLD."totalTokens")
 THEN RAISE EXCEPTION 'Confirmed provider costs are immutable'; END IF;
 IF OLD."dispatchedAt" IS NOT NULL AND NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt"
 THEN RAISE EXCEPTION 'Dispatch time is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ProviderAttempt_immutable" BEFORE UPDATE ON "ProviderAttempt" FOR EACH ROW EXECUTE FUNCTION preserve_provider_attempt_snapshot();

-- Real existing routes only. No new public models, credentials or balances.
INSERT INTO "ProviderChannel" (id,code,name,provider,"apiKeyEnv","baseUrlEnv","updatedAt")
SELECT md5('aihub-primary-' || provider::text)::uuid, lower(provider::text) || '-primary',
 provider::text || ' Primary', provider,
 CASE WHEN provider = 'GOOGLE' THEN 'GEMINI_API_KEY' ELSE provider::text || '_API_KEY' END,
 CASE WHEN provider = 'GOOGLE' THEN 'GEMINI_BASE_URL' ELSE provider::text || '_BASE_URL' END, NOW()
FROM "Model" GROUP BY provider;
INSERT INTO "ModelChannel" (id,"modelId","channelId","providerModel","contextWindow","inputPricePerMillion","outputPricePerMillion","updatedAt")
SELECT gen_random_uuid(),m.id,c.id,m."providerModel",m."contextWindow",m."inputPricePerMillion",m."outputPricePerMillion",NOW()
FROM "Model" m JOIN "ProviderChannel" c ON c.code = lower(m.provider::text) || '-primary';
