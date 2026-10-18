import "server-only";
import { isIP } from "node:net";
import { createClient } from "redis";
import { readLimitedJson } from "@/lib/ai/http";
import { upstreamFetch } from "@/lib/security/upstream";

export class RiskUnavailable extends Error { constructor() { super("Request protection is temporarily unavailable."); } }
let client: ReturnType<typeof createClient> | undefined, connecting: Promise<unknown> | undefined;
class CommandDeadline extends Error {}
async function connection() {
  if (!client) {
    const value = process.env.REDIS_URL;
    if (!value) throw new RiskUnavailable();
    const url = new URL(value);
    if (!["redis:", "rediss:"].includes(url.protocol) || url.hash || url.search) throw new RiskUnavailable();
    if (url.protocol === "redis:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new RiskUnavailable();
    client = createClient({ url: value, disableOfflineQueue: true, commandsQueueMaxLength: 2048,
      socket: { connectTimeout: 2000, socketTimeout: 5000, reconnectStrategy: false } });
    client.on("error", () => {}); // The boundary logs only a safe, fixed error category.
  }
  const current = client;
  if (!current.isReady) {
    if (!connecting) {
      const attempt: Promise<unknown> = current.connect().catch(error => {
        if (current.isOpen) current.destroy();
        if (client === current) client = undefined;
        throw error;
      }).finally(() => { if (connecting === attempt) connecting = undefined; });
      connecting = attempt;
    }
    await connecting;
  }
  return current;
}
export async function evalRisk(script: string, keys: string[], args: string[]): Promise<unknown> {
  let owned: ReturnType<typeof createClient> | undefined;
  try {
    const restUrl = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (restUrl || token) {
      if (!restUrl || !token || /[\r\n]/.test(token)) throw new RiskUnavailable();
      const url = new URL(restUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new RiskUnavailable();
      const signal = AbortSignal.timeout(2500);
      if (url.hostname === "localhost" || isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new RiskUnavailable();
      const response = await upstreamFetch(url, { method: "POST", redirect: "error", cache: "no-store", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(["EVAL", script, String(keys.length), ...keys, ...args]) });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new RiskUnavailable(); }
      const body = await readLimitedJson(response, 16384, signal) as { result?: unknown; error?: unknown };
      if (!body || typeof body !== "object" || body.error || !Object.hasOwn(body, "result")) throw new RiskUnavailable();
      return body.result;
    }
    owned = await connection();
    const signal = AbortSignal.timeout(2500);
    // node-redis removes queued-command abort listeners once a command is sent.
    // Bound the response wait too. A late Lua result must never authorize the
    // expired request; its conservative quota/lease expires through existing Lua.
    const pending = owned.withAbortSignal(signal).eval(script, { keys, arguments: args });
    return await new Promise((resolve, reject) => {
      const expire = () => reject(new CommandDeadline());
      signal.addEventListener("abort", expire, { once: true });
      if (signal.aborted) expire();
      void pending.then(value => { signal.removeEventListener("abort", expire); resolve(value); },
        error => { signal.removeEventListener("abort", expire); reject(error); });
    });
  } catch {
    // Preserve reply correlation for other in-flight commands on a healthy
    // connection. The bounded queue and socket watchdog cap a real stall. An
    // older connection's rejection must never destroy its newer replacement.
    // Command-level errors (including queue capacity) do not corrupt a ready
    // RESP connection. Destroy only an actually unavailable transport.
    if (owned && !owned.isReady) {
      if (owned.isOpen) owned.destroy();
      if (client === owned) client = undefined;
    }
    throw new RiskUnavailable(); // Never propagate a Redis URL, token, or raw exception.
  }
}
export async function closeRiskRedis() {
  if (client?.isOpen) client.destroy(); client = undefined; connecting = undefined;
}
