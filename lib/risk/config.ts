import "server-only";

export function riskInteger(name: string, fallback: number, maximum = 1000000000) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error("Invalid risk configuration.");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error("Invalid risk configuration.");
  return number;
}
export function riskNamespace() {
  const value = process.env.REDIS_NAMESPACE ?? "aihub";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Invalid risk configuration.");
  // One cluster hash slot permits an atomic decision over all limit dimensions.
  return `{${value}}:risk`;
}
export function gatewayPolicy() {
  return {
    userRpm: riskInteger("GATEWAY_USER_RPM", 60, 100000),
    keyRpm: riskInteger("GATEWAY_API_KEY_RPM", riskInteger("GATEWAY_REQUESTS_PER_MINUTE", 60, 100000), 100000),
    userTpm: riskInteger("GATEWAY_USER_TPM", 200000), keyTpm: riskInteger("GATEWAY_API_KEY_TPM", 200000),
    ipRpm: riskInteger("GATEWAY_IP_RPM", 300, 100000), ipTpm: riskInteger("GATEWAY_IP_TPM", 1000000),
    endpointRpm: riskInteger("GATEWAY_ENDPOINT_RPM", 12000, 1000000), endpointTpm: riskInteger("GATEWAY_ENDPOINT_TPM", 20000000),
    concurrency: riskInteger("GATEWAY_API_KEY_CONCURRENCY", 10, 1000),
  };
}
export const sensitiveDefaults = { login: 10, register: 5, "create-api-key": 10, "payment-create": 10, "password-reset": 3 } as const;
export type SensitiveEndpoint = keyof typeof sensitiveDefaults;
