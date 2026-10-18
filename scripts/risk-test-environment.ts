import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "redis";
import type { PrismaClient, Model } from "../generated/prisma/client";

export function riskTestEnvironment(suite: string) {
  const value = process.env.REDIS_URL_TEST;
  assert(value && value !== process.env.REDIS_URL, "Configure a separate local REDIS_URL_TEST before running integration tests.");
  const url = new URL(value);
  assert(url.protocol === "redis:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/15", "Tests only use local Redis database 15.");
  const namespace = `test-${suite}-${randomBytes(8).toString("hex")}`;
  // Only isolated fixtures may use HTTP loopback providers. Production additionally
  // requires DATABASE_URL to match the named local test database.
  process.env.AIHUB_LOCAL_PROVIDER_TESTS = "true";
  const env: Record<string, string> = {
    AIHUB_LOCAL_PROVIDER_TESTS: "true",
    REDIS_URL: value, UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", REDIS_NAMESPACE: namespace,
    IP_HASH_SECRET: randomBytes(32).toString("hex"), TRUSTED_IP_HEADER: "",
    GATEWAY_USER_RPM: "100000", GATEWAY_API_KEY_RPM: "", GATEWAY_INVALID_KEY_IP_RPM: "100000",
    GATEWAY_USER_TPM: "1000000000", GATEWAY_API_KEY_TPM: "1000000000", GATEWAY_IP_TPM: "1000000000", GATEWAY_ENDPOINT_TPM: "1000000000",
    GATEWAY_IP_RPM: "100000", GATEWAY_ENDPOINT_RPM: "1000000", GATEWAY_API_KEY_CONCURRENCY: "1000",
    PROVIDER_CHANNEL_RPM: "1000000", PROVIDER_CHANNEL_TPM: "1000000000", PROVIDER_CHANNEL_CONCURRENCY: "1000",
    PROVIDER_FAILURE_THRESHOLD: "1000", ROUTER_MAX_RETRIES: "0",
  };
  for (const endpoint of ["LOGIN", "REGISTER", "CREATE_API_KEY", "PAYMENT_CREATE", "PASSWORD_RESET"]) {
    env[`RISK_${endpoint}_IP_RPM`] = "10000"; env[`RISK_${endpoint}_USER_RPM`] = "10000";
  }
  return { env, namespace, async bindRouting(db: PrismaClient, model: Model, config: NodeJS.ProcessEnv) {
    const test = config.DATABASE_URL;
    assert(test && test === process.env.DATABASE_URL_TEST && new URL(test).pathname === "/aihub_auth_test", "Routing fixtures require the isolated test database.");
    const prefix = model.provider === "GOOGLE" ? "GEMINI" : model.provider;
    const channel = await db.providerChannel.create({ data: {
      code: `fixture-${suite}-${model.id}`, name: "Isolated provider fixture", provider: model.provider,
      apiKeyEnv: `${prefix}_API_KEY`, baseUrlEnv: `${prefix}_BASE_URL`, timeoutMs: Number(config[`${prefix}_TIMEOUT_MS`] ?? "90000"),
      rpm: 1000000, tpm: 1000000000, concurrency: 1000, failureThreshold: 1000,
    } });
    await db.modelChannel.create({ data: { modelId: model.id, channelId: channel.id, providerModel: model.providerModel,
      contextWindow: model.contextWindow, inputPricePerMillion: model.inputPricePerMillion, outputPricePerMillion: model.outputPricePerMillion } });
  }, async cleanupRouting(db: PrismaClient) {
    await db.providerChannel.deleteMany({ where: { code: { startsWith: `fixture-${suite}-` }, models: { none: {} }, attempts: { none: {} } } });
  }, async seedRpm(apiKeyId: string, count: number) {
    const client = createClient({ url: value, socket: { reconnectStrategy: false, connectTimeout: 2000 } });
    client.on("error", () => {});
    try { await client.connect(); await client.zAdd(`{${namespace}}:risk:key:chat-completions:${apiKeyId}:rpm`, Array.from({ length: count }, (_, i) => ({ score: Date.now(), value: `fixture-${i}` }))); }
    finally { if (client.isOpen) client.destroy(); }
  }, async cleanup() {
    const client = createClient({ url: value, socket: { reconnectStrategy: false, connectTimeout: 2000 } });
    client.on("error", () => {});
    try {
      await client.connect();
      for await (const keys of client.scanIterator({ MATCH: `{${namespace}}:risk:*`, COUNT: 200 })) if (keys.length) await client.del(keys);
    } finally { if (client.isOpen) client.destroy(); }
  } };
}
