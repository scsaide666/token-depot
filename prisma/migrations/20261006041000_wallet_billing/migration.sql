-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('USAGE');

-- AlterTable
ALTER TABLE "ApiRequest" ADD COLUMN     "estimatedInputTokens" INTEGER,
ADD COLUMN     "inputPricePerMillion" DECIMAL(20,8),
ADD COLUMN     "markupMultiplier" DECIMAL(12,6),
ADD COLUMN     "maxOutputTokens" INTEGER,
ADD COLUMN     "modelContextWindow" INTEGER,
ADD COLUMN     "modelSlug" VARCHAR(100),
ADD COLUMN     "outputPricePerMillion" DECIMAL(20,8),
ADD COLUMN     "providerCost" DECIMAL(50,20),
ADD COLUMN     "reservationExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "reservedAmount" DECIMAL(50,20) NOT NULL DEFAULT 0,
ADD COLUMN     "settledAt" TIMESTAMPTZ(3),
ADD COLUMN     "userCost" DECIMAL(50,20);

-- AlterTable
ALTER TABLE "Wallet" ALTER COLUMN "balance" SET DATA TYPE DECIMAL(50,20),
ALTER COLUMN "reservedBalance" SET DATA TYPE DECIMAL(50,20);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "WalletTransactionType" NOT NULL DEFAULT 'USAGE',
    "amount" DECIMAL(50,20) NOT NULL,
    "balanceBefore" DECIMAL(50,20) NOT NULL,
    "balanceAfter" DECIMAL(50,20) NOT NULL,
    "requestId" UUID NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_requestId_key" ON "WalletTransaction"("requestId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequest_userId_status_reservationExpiresAt_idx" ON "ApiRequest"("userId", "status", "reservationExpiresAt");

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApiRequest"("requestId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_finite_money" CHECK (
  "balance" <> 'NaN'::numeric AND "reservedBalance" <> 'NaN'::numeric
);
ALTER TABLE "Model" ADD CONSTRAINT "Model_finite_prices" CHECK (
  "inputPricePerMillion" <> 'NaN'::numeric AND "outputPricePerMillion" <> 'NaN'::numeric AND "markupMultiplier" <> 'NaN'::numeric
);
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_usage_check" CHECK (
  "amount" <= 0 AND "balanceBefore" >= 0 AND "balanceAfter" >= 0
  AND "balanceAfter" = "balanceBefore" + "amount"
  AND "amount" <> 'NaN'::numeric AND "balanceBefore" <> 'NaN'::numeric AND "balanceAfter" <> 'NaN'::numeric
);
ALTER TABLE "ApiRequest" DROP CONSTRAINT "ApiRequest_result_check";
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_result_check" CHECK (
  ("status" = 'SUCCESS' AND "errorCode" IS NULL AND "totalTokens" IS NOT NULL)
  OR ("status" = 'FAILED' AND "errorCode" IS NOT NULL)
  OR ("status" = 'PENDING' AND "errorCode" IS NULL AND "totalTokens" IS NULL)
);
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_money_check" CHECK (
  "reservedAmount" >= 0 AND "reservedAmount" <> 'NaN'::numeric
  AND ("providerCost" IS NULL OR ("providerCost" >= 0 AND "providerCost" <> 'NaN'::numeric))
  AND ("userCost" IS NULL OR ("userCost" >= 0 AND "userCost" <> 'NaN'::numeric))
);
-- Historical records and preflight rejections remain unbilled. Never retroactively charge them.
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
     OR ("status" = 'SUCCESS' AND "settledAt" IS NOT NULL AND "providerCost" IS NOT NULL AND "userCost" IS NOT NULL AND "userCost" = "providerCost" * "markupMultiplier")
     OR ("status" = 'FAILED' AND "settledAt" IS NOT NULL AND "userCost" IS NOT NULL AND "userCost" = 0)
   )
   AND ("providerCost" IS NULL OR ("totalTokens" IS NOT NULL AND "providerCost" = ("inputTokens"::numeric * "inputPricePerMillion" + "outputTokens"::numeric * "outputPricePerMillion") * 0.000001)))
);
