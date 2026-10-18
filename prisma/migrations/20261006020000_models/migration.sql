-- CreateEnum
CREATE TYPE "ModelProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'DEEPSEEK');

-- CreateTable
CREATE TABLE "Model" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "provider" "ModelProvider" NOT NULL,
    "providerModel" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "contextWindow" INTEGER NOT NULL,
    "inputPricePerMillion" DECIMAL(20,8) NOT NULL,
    "outputPricePerMillion" DECIMAL(20,8) NOT NULL,
    "markupMultiplier" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Model_slug_key" ON "Model"("slug");

-- CreateIndex
CREATE INDEX "Model_enabled_provider_idx" ON "Model"("enabled", "provider");
ALTER TABLE "Model" ADD CONSTRAINT "Model_non_negative_prices" CHECK ("inputPricePerMillion" >= 0 AND "outputPricePerMillion" >= 0), ADD CONSTRAINT "Model_positive_markup" CHECK ("markupMultiplier" > 0), ADD CONSTRAINT "Model_positive_context" CHECK ("contextWindow" > 0);
