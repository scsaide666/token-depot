-- Owner-first composites support bounded chronological pages and common filters.
CREATE INDEX "ApiRequest_userId_createdAt_id_idx" ON "ApiRequest"("userId", "createdAt", "id");
CREATE INDEX "ApiRequest_userId_status_createdAt_id_idx" ON "ApiRequest"("userId", "status", "createdAt", "id");
CREATE INDEX "ApiRequest_userId_modelId_createdAt_id_idx" ON "ApiRequest"("userId", "modelId", "createdAt", "id");
CREATE INDEX "ApiRequest_userId_apiKeyId_createdAt_id_idx" ON "ApiRequest"("userId", "apiKeyId", "createdAt", "id");
CREATE INDEX "WalletTransaction_walletId_createdAt_id_idx" ON "WalletTransaction"("walletId", "createdAt", "id");
