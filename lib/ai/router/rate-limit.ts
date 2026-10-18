import "server-only";
import { gatewayPolicy, riskInteger } from "@/lib/risk/config";
import { admitRisk, RiskLimited, type RiskPermit } from "@/lib/risk/limiter";
import { RiskUnavailable } from "@/lib/risk/redis";
import { GatewayError } from "../types";

const endpoint = "chat-completions";
export function gatewayRiskError(error: unknown) {
  if (error instanceof RiskLimited) return new GatewayError(429, "Rate limit exceeded. Please retry later.", "rate_limit_error", "rate_limit_exceeded", error.retryAfter);
  if (error instanceof RiskUnavailable) return new GatewayError(503, "Request protection is temporarily unavailable. Please retry later.", "server_error", "risk_unavailable");
  return undefined;
}
async function protect<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { throw error instanceof RiskLimited ? error : new RiskUnavailable(); }
}
export function limitGatewayEdge(ipHash: string, requestId: string) {
  return protect(async () => {
    const policy = gatewayPolicy();
    await admitRisk({ id: `edge:${requestId}`, dimensions: [
      { scope: "ip", id: `${endpoint}:${ipHash}`, rpm: policy.ipRpm, tpm: 0 },
      { scope: "endpoint", id: endpoint, rpm: policy.endpointRpm, tpm: 0 },
    ] });
  });
}
export function limitInvalidKey(ipHash: string, requestId: string) {
  return protect(async () => {
    await admitRisk({ id: `invalid:${requestId}`, dimensions: [{ scope: "ip", id: `invalid-key:${ipHash}`, rpm: riskInteger("GATEWAY_INVALID_KEY_IP_RPM", 10, 100000), tpm: 0 }] });
  });
}
type Identity = { userId: string; apiKeyId: string | null };
// All Session requests for a user share one key scope and one concurrency lease.
const keyScope = (identity: Identity) => identity.apiKeyId ?? `playground-${identity.userId}`;
export function limitGatewayIdentity(identity: Identity, requestId: string) {
  return protect(async () => {
    const policy = gatewayPolicy();
    await admitRisk({ id: `identity:${requestId}`, dimensions: [
      { scope: "user", id: `${endpoint}:${identity.userId}`, rpm: policy.userRpm, tpm: 0 },
      { scope: "key", id: `${endpoint}:${keyScope(identity)}`, rpm: policy.keyRpm, tpm: 0 },
    ] });
  });
}
export function limitGatewayRequest(identity: Identity, ipHash: string, requestId: string, tokens: number): Promise<RiskPermit> {
  return protect(async () => {
    const policy = gatewayPolicy();
    return admitRisk({ id: requestId, tokens, concurrencyKey: keyScope(identity), concurrency: policy.concurrency, dimensions: [
      { scope: "user", id: `${endpoint}:${identity.userId}`, rpm: 0, tpm: policy.userTpm },
      { scope: "key", id: `${endpoint}:${keyScope(identity)}`, rpm: 0, tpm: policy.keyTpm },
      { scope: "ip", id: `${endpoint}:${ipHash}`, rpm: 0, tpm: policy.ipTpm },
      { scope: "endpoint", id: endpoint, rpm: 0, tpm: policy.endpointTpm },
    ] });
  });
}
