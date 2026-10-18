-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "keyPrefix" VARCHAR(13) NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_createdAt_idx" ON "ApiKey"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Retain only a short display prefix and a SHA-256 digest.
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_valid_hash" CHECK ("keyHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_valid_prefix" CHECK ("keyPrefix" ~ '^sk-aihub-[A-Za-z0-9_-]{4}$');
