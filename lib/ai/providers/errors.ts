import "server-only";
import { GatewayError, providerError } from "../types";

// Inspect a bounded error only for classification; never return or log its text.
export function normalizeProviderError(status?: number, response?: unknown): GatewayError {
  const body = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.slice(0, 2048) : "";
  const reasons = Array.isArray(error.details) ? error.details.slice(0, 10).flatMap((detail) => detail && typeof detail === "object" && "reason" in detail && typeof detail.reason === "string" ? [detail.reason] : []) : [];
  if (status === 408 || status === 504) return new GatewayError(504, "The upstream provider timed out.", "server_error", "provider_timeout");
  if (status === 429) return new GatewayError(429, "The upstream provider is temporarily rate limited. Please retry later.", "rate_limit_error", "provider_rate_limit", 60);
  // Google may report invalid provider credentials as HTTP 400 ErrorInfo.
  if (status === 401 || status === 403 || status === 400 && (code === "invalid_api_key" || reasons.some((reason) => ["API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_SERVICE_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED"].includes(reason)))) return new GatewayError(502, "The upstream provider is temporarily unavailable.", "server_error", "provider_auth_error");
  if (status === 400 || status === 422) {
    const contextExceeded = code === "context_length_exceeded" || /prompt is too long|maximum context length|context (?:window|length).*(?:exceed|limit)|input token count.*exceed/i.test(message);
    return new GatewayError(400, contextExceeded ? "The requested token budget exceeds this model's limits." : "The model could not accept these request parameters.", "invalid_request_error", contextExceeded ? "context_length_exceeded" : "invalid_request");
  }
  return providerError();
}
