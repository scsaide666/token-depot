import "server-only";
import { riskNamespace } from "./config";
import { evalRisk } from "./redis";
import { behaviorScript } from "./scripts";
import { riskLog } from "./log";

type Behavior = "invalid_api_key" | "failed_requests" | "provider_failures" | "concurrent_burst" | "key_creation_burst" | "payment_creation_burst";
export async function recordBehavior(kind: Behavior, context: { ipHash: string; requestId?: string; userId?: string; apiKeyPrefix?: string }, scope = context.userId ?? context.ipHash) {
  const threshold = kind === "invalid_api_key" ? 10 : kind.includes("burst") ? 5 : 20;
  try {
    const count = await evalRisk(behaviorScript, [`${riskNamespace()}:behavior:${kind}:${scope}`], ["60000"]);
    if (typeof count === "number" && (count === threshold || count % (threshold * 5) === 0)) riskLog({ event: "risk_signal", reason: kind, ...context, count });
  } catch { riskLog({ event: "risk_unavailable", reason: "behavior_store_unavailable", ...context }); }
}
