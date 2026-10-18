import { GatewayError } from "@/lib/ai/types";

export type RetryDecision = "STOP" | "COMPATIBLE_CHANNEL" | "SAME_IDEMPOTENT_CHANNEL";
export function retryDecision(error: GatewayError, idempotent: boolean, attempts: number, maxAttempts: number): RetryDecision {
  if (attempts >= maxAttempts || error.providerFailure?.outputStarted || error.code === "request_cancelled" || (error.usage?.totalTokens ?? 0) > 0) return "STOP";
  if (!["provider_timeout", "provider_rate_limit", "provider_unavailable"].includes(error.code)) return "STOP";
  if (error.providerFailure?.execution === "REJECTED" || error.providerFailure?.execution === "NOT_SENT") return "COMPATIBLE_CHANNEL";
  // A header alone is not proof of idempotency: only an administrator's explicit,
  // verified channel contract permits replay, and never on a different channel.
  return idempotent && error.providerFailure?.execution === "UNCERTAIN" ? "SAME_IDEMPOTENT_CHANNEL" : "STOP";
}
