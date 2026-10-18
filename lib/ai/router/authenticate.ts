import "server-only";
import { getDb } from "@/lib/server/db";
import { hashApiKey, matchesApiKeyHash } from "@/lib/server/api-key-crypto";
import { GatewayError } from "../types";

export async function authenticateApiKey(request: Request) {
  const match = /^Bearer (sk-aihub-[A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "");
  const invalid = () => new GatewayError(401, "Invalid API key", "authentication_error", "invalid_api_key");
  if (!match) throw invalid();
  const key = await getDb().apiKey.findUnique({
    where: { keyHash: hashApiKey(match[1]) },
    select: { id: true, userId: true, keyPrefix: true, keyHash: true, revokedAt: true, expiresAt: true, user: { select: { status: true } } },
  });
  if (!key || !matchesApiKeyHash(match[1], key.keyHash) || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) throw invalid();
  // Return only identity and status; never retain the secret or its hash in context/logs.
  return { apiKeyId: key.id, apiKeyPrefix: key.keyPrefix, userId: key.userId, userStatus: key.user.status };
}
