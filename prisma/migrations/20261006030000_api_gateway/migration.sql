-- CreateEnum
CREATE TYPE "ApiRequestStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ApiRequest" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "apiKeyId" UUID,
    "modelId" UUID,
    "provider" "ModelProvider",
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "status" "ApiRequestStatus" NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayRateLimit" (
    "apiKeyId" UUID NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GatewayRateLimit_pkey" PRIMARY KEY ("apiKeyId","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiRequest_requestId_key" ON "ApiRequest"("requestId");

-- CreateIndex
CREATE INDEX "ApiRequest_userId_createdAt_idx" ON "ApiRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequest_apiKeyId_createdAt_idx" ON "ApiRequest"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequest_modelId_createdAt_idx" ON "ApiRequest"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "GatewayRateLimit_windowStart_idx" ON "GatewayRateLimit"("windowStart");

-- AddForeignKey
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayRateLimit" ADD CONSTRAINT "GatewayRateLimit_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_usage_check" CHECK (
  ("inputTokens" IS NULL AND "outputTokens" IS NULL AND "totalTokens" IS NULL)
  OR ("inputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL AND "totalTokens" IS NOT NULL
      AND "inputTokens" >= 0 AND "outputTokens" >= 0
      AND "totalTokens"::bigint = "inputTokens"::bigint + "outputTokens"::bigint)
);
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_result_check" CHECK (
  ("status" = 'SUCCESS' AND "errorCode" IS NULL AND "totalTokens" IS NOT NULL)
  OR ("status" = 'FAILED' AND "errorCode" IS NOT NULL)
);
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_latency_check" CHECK ("latencyMs" >= 0);
ALTER TABLE "GatewayRateLimit" ADD CONSTRAINT "GatewayRateLimit_attempts_check" CHECK ("attempts" > 0);
