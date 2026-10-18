import "server-only";
import { randomUUID } from "node:crypto";
import { sensitiveDefaults, riskInteger, type SensitiveEndpoint } from "./config";
import { requestIpHash } from "./identity";
import { admitRisk, RiskLimited } from "./limiter";
import { recordBehavior } from "./behavior";
import { riskLog } from "./log";
import { RiskUnavailable } from "./redis";

export async function limitSensitiveRequest(request: Request, endpoint: SensitiveEndpoint, userId?: string) {
  let ipHash: string;
  try { ipHash = requestIpHash(request); } catch { throw new RiskUnavailable(); }
  const requestId = randomUUID(), name = endpoint.replaceAll("-", "_").toUpperCase();
  try {
    const limit = riskInteger(`RISK_${name}_IP_RPM`, sensitiveDefaults[endpoint], 10000);
    await admitRisk({ id: requestId, dimensions: [
      { scope: "ip", id: `${endpoint}:${ipHash}`, rpm: limit, tpm: 0 },
      { scope: "endpoint", id: endpoint, rpm: riskInteger(`RISK_${name}_ENDPOINT_RPM`, 3000, 100000), tpm: 0 },
      ...(userId ? [{ scope: "user" as const, id: `${endpoint}:${userId}`, rpm: riskInteger(`RISK_${name}_USER_RPM`, sensitiveDefaults[endpoint], 10000), tpm: 0 }] : []),
    ] });
  } catch (error) {
    if (error instanceof RiskLimited) riskLog({ event: "rate_limit", requestId, userId, ipHash, endpoint, reason: `${error.scope}_${error.reason}`, status: 429 });
    throw error instanceof RiskLimited ? error : new RiskUnavailable();
  }
  if (endpoint === "create-api-key" || endpoint === "payment-create") await recordBehavior(endpoint === "create-api-key" ? "key_creation_burst" : "payment_creation_burst", { requestId, userId, ipHash });
  return { requestId, userId, ipHash };
}
