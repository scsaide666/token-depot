import "server-only";
import { createHash } from "node:crypto";
import { evalRisk } from "@/lib/risk/redis";
import { riskNamespace } from "@/lib/risk/config";

// Metadata only. Never put sessions, credentials, balances or admission decisions here.
// The namespace also separates databases sharing a Redis deployment.
const inFlight = new Map<string, Promise<unknown>>();
const local = new Map<string, { value: unknown; expiresAt: number }>();
let unavailableUntil = 0;
const MAX_BYTES = 12000;
const read = "local v=redis.call('GET',KEYS[1]); if v and string.len(v)<=12000 then return {v,redis.call('PTTL',KEYS[1])} end; return false";
const write = "redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[2]); return 1";
function remember(key: string, value: unknown, expiresAt: number) {
  local.delete(key);
  if (local.size >= 256) local.delete(local.keys().next().value!);
  local.set(key, { value, expiresAt });
}

export async function metadataCache<T>(name: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const database = createHash("sha256").update(process.env.DATABASE_URL ?? "").digest("hex").slice(0, 20);
  const key = `${riskNamespace()}:metadata:${database}:${name}`;
  const nearby = local.get(key);
  if (nearby && nearby.expiresAt > Date.now()) {
    local.delete(key); local.set(key, nearby);
    return nearby.value as T;
  }
  local.delete(key);
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  const pending = (async () => {
    if (Date.now() >= unavailableUntil) {
      try {
        const began = Date.now();
        const cached = await evalRisk(read, [key], []);
        if (Array.isArray(cached) && typeof cached[0] === "string" && typeof cached[1] === "number" && cached[1] > 0) {
          const expiresAt = began + Math.min(ttlMs, cached[1]);
          if (expiresAt > Date.now()) {
            const value = JSON.parse(cached[0]) as T;
            remember(key, value, expiresAt);
            return value;
          }
        }
      } catch { unavailableUntil = Date.now() + 5000; }
    }
    const value = await load();
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, "utf8") <= MAX_BYTES) {
      const expiresAt = Date.now() + ttlMs;
      remember(key, value, expiresAt);
      if (Date.now() >= unavailableUntil) {
        try { await evalRisk(write, [key], [encoded, String(ttlMs)]); }
        catch { unavailableUntil = Date.now() + 5000; }
      }
    }
    return value;
  })();
  inFlight.set(key, pending);
  try { return await pending; } finally { inFlight.delete(key); }
}
