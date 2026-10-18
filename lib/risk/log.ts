import "server-only";

type SafeEvent = {
  event: "api_request" | "rate_limit" | "risk_signal" | "risk_unavailable";
  requestId?: string; userId?: string; apiKeyPrefix?: string; model?: string;
  endpoint?: string; status?: number; latencyMs?: number; tokens?: number; cost?: string;
  ipHash?: string; reason?: string; count?: number;
};
const uuid = /^[a-f0-9-]{36}$/i, identifier = /^[a-zA-Z0-9_.:/-]{1,100}$/;
export function riskLog(input: SafeEvent) {
  // Construct the output field by field. Never spread objects, errors, bodies or headers.
  const result: Record<string, string | number> = { event: input.event };
  for (const field of ["requestId", "userId"] as const) if (input[field] && uuid.test(input[field]!)) result[field] = input[field]!;
  if (input.apiKeyPrefix && /^sk-aihub-[A-Za-z0-9_-]{4}$/.test(input.apiKeyPrefix)) result.apiKeyPrefix = input.apiKeyPrefix;
  if (input.ipHash && /^[a-f0-9]{64}$/.test(input.ipHash)) result.ipHash = input.ipHash;
  for (const field of ["model", "endpoint", "reason"] as const) if (input[field] && identifier.test(input[field]!) && !input[field]!.includes("sk-")) result[field] = input[field]!;
  for (const field of ["status", "latencyMs", "tokens", "count"] as const) if (input[field] !== undefined && Number.isSafeInteger(input[field]) && input[field]! >= 0) result[field] = input[field]!;
  if (input.cost && /^\d{1,30}(\.\d{1,20})?$/.test(input.cost)) result.cost = input.cost;
  console.info(JSON.stringify(result));
}
