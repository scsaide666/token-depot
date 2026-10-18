-- Commit the new enum value before constraints/transactions use it in the next migration.
ALTER TYPE "WalletTransactionType" ADD VALUE 'RECHARGE';
CREATE TYPE "PaymentMethod" AS ENUM ('ALIPAY', 'WECHAT');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CLOSED', 'REFUNDED');
