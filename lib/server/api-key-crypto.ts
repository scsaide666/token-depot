import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const hashApiKey = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

export function generateApiKey() {
  const key = `sk-aihub-${randomBytes(32).toString("base64url")}`;
  return { key, keyPrefix: key.slice(0, 13), keyHash: hashApiKey(key) };
}

// API keys are high-entropy secrets; compare their SHA-256 digests in constant time.
export function matchesApiKeyHash(key: string, storedHash: string) {
  if (!/^sk-aihub-[A-Za-z0-9_-]{43}$/.test(key) || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(hashApiKey(key), "hex"), Buffer.from(storedHash, "hex"));
}
