-- CreateEnum
CREATE TYPE "CircuitState" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

-- CreateEnum
CREATE TYPE "ProviderCostStatus" AS ENUM ('KNOWN', 'NOT_INCURRED', 'PENDING_RECONCILIATION');

-- CreateEnum
CREATE TYPE "ExecutionState" AS ENUM ('NOT_SENT', 'REJECTED', 'UNCERTAIN', 'COMPLETED');

-- AlterTable
ALTER TABLE "ApiRequest" ADD COLUMN     "providerCostStatus" "ProviderCostStatus";

-- CreateTable
CREATE TABLE "ProviderChannel" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "provider" "ModelProvider" NOT NULL,
    "apiKeyEnv" VARCHAR(100) NOT NULL,
    "baseUrlEnv" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "timeoutMs" INTEGER NOT NULL DEFAULT 90000,
    "rpm" INTEGER NOT NULL DEFAULT 60,
    "tpm" INTEGER NOT NULL DEFAULT 200000,
    "concurrency" INTEGER NOT NULL DEFAULT 10,
    "failureThreshold" INTEGER NOT NULL DEFAULT 5,
    "cooldownMs" INTEGER NOT NULL DEFAULT 30000,
    "idempotentRequests" BOOLEAN NOT NULL DEFAULT false,
    "circuitState" "CircuitState" NOT NULL DEFAULT 'CLOSED',
    "circuitVersion" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "openedUntil" TIMESTAMPTZ(3),
    "rateLimitedUntil" TIMESTAMPTZ(3),
    "probeAttemptId" UUID,
    "probeExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelChannel" (
    "id" UUID NOT NULL,
    "modelId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "providerModel" VARCHAR(200) NOT NULL,
    "contextWindow" INTEGER NOT NULL,
    "inputPricePerMillion" DECIMAL(22,8) NOT NULL,
    "outputPricePerMillion" DECIMAL(22,8) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ModelChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAttempt" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "bindingId" UUID,
    "attemptNumber" INTEGER NOT NULL,
    "executionGroup" CHAR(64) NOT NULL,
    "provider" "ModelProvider" NOT NULL,
    "providerModel" VARCHAR(200) NOT NULL,
    "status" "ApiRequestStatus" NOT NULL DEFAULT 'PENDING',
    "executionState" "ExecutionState" NOT NULL DEFAULT 'NOT_SENT',
    "costStatus" "ProviderCostStatus" NOT NULL DEFAULT 'NOT_INCURRED',
    "providerCost" DECIMAL(50,20),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "inputPricePerMillion" DECIMAL(22,8) NOT NULL,
    "outputPricePerMillion" DECIMAL(22,8) NOT NULL,
    "estimatedTokens" INTEGER NOT NULL,
    "circuitVersion" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "errorCode" VARCHAR(64),
    "upstreamStatus" INTEGER,
    "dispatchedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderChannel_code_key" ON "ProviderChannel"("code");

-- CreateIndex
CREATE INDEX "ProviderChannel_enabled_provider_priority_idx" ON "ProviderChannel"("enabled", "provider", "priority");

-- CreateIndex
CREATE INDEX "ModelChannel_modelId_enabled_idx" ON "ModelChannel"("modelId", "enabled");

-- CreateIndex
CREATE INDEX "ModelChannel_channelId_createdAt_id_idx" ON "ModelChannel"("channelId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ModelChannel_modelId_channelId_key" ON "ModelChannel"("modelId", "channelId");

-- CreateIndex
CREATE INDEX "ProviderAttempt_channelId_createdAt_status_idx" ON "ProviderAttempt"("channelId", "createdAt", "status");

-- CreateIndex
CREATE INDEX "ProviderAttempt_channelId_status_expiresAt_idx" ON "ProviderAttempt"("channelId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ProviderAttempt_executionGroup_costStatus_idx" ON "ProviderAttempt"("executionGroup", "costStatus");

-- CreateIndex
CREATE INDEX "ProviderAttempt_requestId_status_idx" ON "ProviderAttempt"("requestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAttempt_requestId_attemptNumber_key" ON "ProviderAttempt"("requestId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "ModelChannel" ADD CONSTRAINT "ModelChannel_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelChannel" ADD CONSTRAINT "ModelChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ProviderChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAttempt" ADD CONSTRAINT "ProviderAttempt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApiRequest"("requestId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAttempt" ADD CONSTRAINT "ProviderAttempt_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ProviderChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAttempt" ADD CONSTRAINT "ProviderAttempt_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ModelChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
