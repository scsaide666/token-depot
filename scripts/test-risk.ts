import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { config } from "dotenv";
import { createClient } from "redis";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { riskTestEnvironment } from "./risk-test-environment";
import { admitRisk, finishRisk, RiskLimited, type LimitDimension, type RiskPermit } from "../lib/risk/limiter";
import { evalRisk, RiskUnavailable, closeRiskRedis } from "../lib/risk/redis";
import { gatewayPolicy, riskNamespace } from "../lib/risk/config";
import { requestIpHash } from "../lib/risk/identity";
import { riskLog } from "../lib/risk/log";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { settleFailure } from "../lib/billing/wallet";
import { getDb } from "../lib/server/db";
import { money } from "../lib/billing/money";

config({ quiet: true });
const databaseUrl = process.env.DATABASE_URL_TEST;
assert(databaseUrl && databaseUrl !== process.env.DATABASE_URL, "Use the isolated test database.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test");
const risk = riskTestEnvironment("risk");
const defaults = {
  GATEWAY_USER_RPM: "60", GATEWAY_API_KEY_RPM: "60", GATEWAY_USER_TPM: "200000", GATEWAY_API_KEY_TPM: "200000",
  GATEWAY_IP_RPM: "300", GATEWAY_IP_TPM: "1000000", GATEWAY_ENDPOINT_RPM: "12000", GATEWAY_ENDPOINT_TPM: "20000000",
  GATEWAY_API_KEY_CONCURRENCY: "10", GATEWAY_INVALID_KEY_IP_RPM: "10",
  RISK_LOGIN_IP_RPM: "10", RISK_REGISTER_IP_RPM: "5", RISK_CREATE_API_KEY_IP_RPM: "10", RISK_CREATE_API_KEY_USER_RPM: "10",
  RISK_PAYMENT_CREATE_IP_RPM: "10", RISK_PAYMENT_CREATE_USER_RPM: "10", RISK_PASSWORD_RESET_IP_RPM: "3",
};
Object.assign(process.env, risk.env, defaults, { DATABASE_URL: databaseUrl, TRUSTED_IP_HEADER: "x-aihub-client-ip" });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 6 }), log: [] });
const redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2000, reconnectStrategy: false } }); redis.on("error", () => {});
const ports = [3130, 3131, 3132], origins = ports.map((port) => `http://127.0.0.1:${port}`), fixtureOrigin = "http://127.0.0.1:3133";
const upstreamKey = `fixture-risk-upstream-${randomBytes(24).toString("hex")}`, promptSecret = `private-risk-prompt-${randomBytes(16).toString("hex")}`;
const passwordSecret = `private-risk-password-${randomBytes(16).toString("hex")}`, responseSecret = `private-risk-response-${randomBytes(16).toString("hex")}`;
const children: ChildProcess[] = [], owners: { id: string; cookie: string; keys: { id: string; secret: string; prefix: string }[] }[] = [], modelIds: string[] = [];
const models: Record<string, { id: string; slug: string }> = {};
let serverOutput = "", passed = 0, activeCheck = "startup", calls = 0, aborted = 0;
const heldReplies: (() => void)[] = [];
const fixtureServer = createServer(async (request, response) => {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string };
  assert.equal(request.headers.authorization, `Bearer ${upstreamKey}`); calls++;
  const send = (target: ServerResponse) => {
    if (target.destroyed) return;
    target.writeHead(200, { "Content-Type": "application/json" });
    target.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: responseSecret }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
  };
  if (body.model === "held") { heldReplies.push(() => send(response)); return; }
  if (body.model === "timeout" || body.model === "slow-body") {
    response.on("close", () => { if (!response.writableEnded) aborted++; });
    if (body.model === "slow-body") { response.writeHead(200, { "Content-Type": "application/json" }); response.write("{"); }
    return;
  }
  if (body.model === "failed") { response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ secret: upstreamKey, prompt: promptSecret })); return; }
  send(response);
});
async function check(name: string, action: () => Promise<void>) {
  activeCheck = name; await risk.cleanup(); await action(); passed++; console.log(`PASS ${name}`);
}
async function waitFor(predicate: () => boolean | Promise<boolean>, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { assert(Date.now() < deadline, "Timed out waiting for isolated fixture."); await new Promise((resolve) => setTimeout(resolve, 20)); }
}
async function createOwner() {
  const user = await db.user.create({ data: { name: "Risk fixture", email: `risk-${randomUUID()}@example.test`, passwordHash: "non-login-fixture", wallet: { create: { balance: "10" } } } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), userAgent: "Risk integration fixture" } });
  const owner = { id: user.id, cookie: `__Host-aihub-session=${token}`, keys: [] as { id: string; secret: string; prefix: string }[] }; owners.push(owner);
  for (let i = 0; i < 3; i++) {
    const key = generateApiKey();
    const row = await db.apiKey.create({ data: { userId: user.id, name: "Risk fixture", keyHash: key.keyHash, keyPrefix: key.keyPrefix } });
    owner.keys.push({ id: row.id, secret: key.key, prefix: key.keyPrefix });
  }
  return owner;
}
async function chat(options: { key?: string; model?: string; body?: unknown; raw?: string; ip?: string; server?: number; headers?: Record<string, string> } = {}) {
  return fetch(`${origins[options.server ?? 0]}/v1/chat/completions`, { method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.key ?? owners[0].keys[0].secret}`, "x-aihub-client-ip": options.ip ?? "192.0.2.1", ...options.headers },
    body: options.raw ?? JSON.stringify(options.body ?? { model: options.model ?? models.success.slug, messages: [{ role: "user", content: promptSecret }], max_tokens: 1 }),
  });
}
async function result(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  const text = await response.text(); assert(!text.includes(upstreamKey));
  const body = JSON.parse(text) as { error?: { code: string } }; if (code) assert.equal(body.error?.code, code);
  if (status === 429) assert(Number(response.headers.get("retry-after")) >= 1);
  const requestId = response.headers.get("x-request-id"); assert(requestId);
  return requestId;
}
async function mutation(path: string, body: unknown, options: { server?: number; cookie?: string; ip?: string } = {}) {
  const origin = origins[options.server ?? 0];
  return fetch(origin + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "x-aihub-client-ip": options.ip ?? "192.0.2.1", ...(options.cookie ? { Cookie: options.cookie } : {}), "Idempotency-Key": randomUUID() }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
}
async function walletUnchanged(userId: string, before: { balance: { toFixed: () => string }; reservedBalance: { toFixed: () => string } }) {
  const after = await db.wallet.findUniqueOrThrow({ where: { userId } });
  assert.equal(after.balance.toFixed(), before.balance.toFixed()); assert.equal(after.reservedBalance.toFixed(), before.reservedBalance.toFixed());
}
const dimension = (scope: LimitDimension["scope"], rpm = 0, tpm = 0, id = "fixture"): LimitDimension => ({ scope, rpm, tpm, id });
async function limited(action: Promise<unknown>, reason: "rpm" | "tpm" | "concurrency", scope?: string) {
  await assert.rejects(action, (error) => error instanceof RiskLimited && error.reason === reason && (!scope || error.scope === scope) && error.retryAfter >= 1);
}
async function startup() {
  for (const origin of [...origins, fixtureOrigin]) assert(await fetch(origin, { signal: AbortSignal.timeout(300) }).then(() => false).catch(() => true), "Risk test ports must be free.");
  await redis.connect();
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", OPENAI_API_KEY: upstreamKey, OPENAI_BASE_URL: `${fixtureOrigin}/v1`, OPENAI_TIMEOUT_MS: "1500", GATEWAY_DEFAULT_MAX_OUTPUT_TOKENS: "1", PAYMENTS_ENABLED: "false" };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" });
  fixtureServer.listen(3133, "127.0.0.1"); await once(fixtureServer, "listening");
  for (let index = 0; index < origins.length; index++) {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(ports[index])], { env: { ...env, APP_ORIGIN: origins[index], ...(index === 2 ? { REDIS_URL: "redis://127.0.0.1:56380/15" } : {}) }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(child);
    const capture = (chunk: Buffer) => { serverOutput += chunk.toString(); }; child.stdout?.on("data", capture); child.stderr?.on("data", capture);
    await waitFor(() => fetch(`${origins[index]}/api/auth/session`, { signal: AbortSignal.timeout(500) }).then((r) => r.status === 200).catch(() => false), 30000);
  }
  await createOwner(); await createOwner();
  for (const mode of ["success", "held", "timeout", "slow-body", "failed"]) {
    const row = await db.model.create({ data: { slug: `risk-${randomBytes(8).toString("hex")}`, name: "Risk fixture", provider: "OPENAI", providerModel: mode, description: "Synthetic upstream only", contextWindow: 500000, inputPricePerMillion: "1", outputPricePerMillion: "2", markupMultiplier: "1.2" } });
    modelIds.push(row.id); models[mode] = row; await risk.bindRouting(db, row, env);
  }
}
async function main() {
  await startup();
  await check("Defaults are 60 RPM, 200000 TPM and 10 concurrent requests", async () => {
    const policy = gatewayPolicy(); assert.equal(policy.userRpm, 60); assert.equal(policy.keyRpm, 60); assert.equal(policy.userTpm, 200000); assert.equal(policy.keyTpm, 200000); assert.equal(policy.concurrency, 10);
  });
  await check("Untrusted forwarding headers cannot change IP identity; IPv6 aliases normalize", async () => {
    process.env.TRUSTED_IP_HEADER = "";
    const hash = (headers: Record<string, string>) => requestIpHash(new Request("https://example.test", { headers }));
    assert.equal(hash({ "x-forwarded-for": "192.0.2.8" }), hash({ "x-forwarded-for": "192.0.2.9", "x-real-ip": "192.0.2.10" }));
    process.env.TRUSTED_IP_HEADER = "x-aihub-client-ip";
    assert.equal(hash({ "x-aihub-client-ip": "2001:db8::1" }), hash({ "x-aihub-client-ip": "2001:0db8:0:0:0:0:0:1" }));
    assert.equal(hash({ "x-aihub-client-ip": "::ffff:192.0.2.1" }), hash({ "x-aihub-client-ip": "192.0.2.1" }));
    assert.equal(hash({ "x-aihub-client-ip": "192.0.2.1, 192.0.2.2" }), hash({}));
    assert.equal(hash({}).length, 64);
  });
  await check("Redis atomically accepts exactly 60 of 100 RPM attempts", async () => {
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => admitRisk({ dimensions: [dimension("key", 60)] })));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 60);
    for (const item of results) if (item.status === "rejected") assert(item.reason instanceof RiskLimited && item.reason.reason === "rpm");
  });
  await check("User, API key, IP and endpoint each enforce independent shared limits", async () => {
    for (const scope of ["user", "key", "ip", "endpoint"] as const) {
      const dimensions = [dimension(scope, 2, 0, `scope-${scope}`)];
      await admitRisk({ dimensions }); await admitRisk({ dimensions }); await limited(admitRisk({ dimensions }), "rpm", scope);
    }
  });
  await check("TPM reservations are atomic, reconcile actual tokens and settle only once", async () => {
    const dimensions = ["user", "key", "ip", "endpoint"].map((scope) => dimension(scope as LimitDimension["scope"], 0, 200000));
    const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => admitRisk({ dimensions, tokens: 100000 })));
    const permits = attempts.filter((r): r is PromiseFulfilledResult<RiskPermit> => r.status === "fulfilled").map((r) => r.value);
    assert.equal(permits.length, 2); assert(attempts.some((r) => r.status === "rejected" && r.reason instanceof RiskLimited));
    await finishRisk(permits[0], 1); await finishRisk(permits[0], 1);
    assert.equal(await redis.get(permits[0].keys[3]), "100001");
    const third = await admitRisk({ dimensions, tokens: 99999 });
    await limited(admitRisk({ dimensions, tokens: 1 }), "tpm");
    await finishRisk(permits[1], 0); await finishRisk(third, 0); assert.equal(await redis.get(permits[0].keys[3]), "1");
  });
  await check("In-flight TPM stays reserved across the minute window; completed usage expires", async () => {
    const dimensions = [dimension("key", 0, 10)], permit = await admitRisk({ dimensions, tokens: 10, windowMs: 40, leaseMs: 500 });
    await new Promise((r) => setTimeout(r, 70)); await limited(admitRisk({ dimensions, tokens: 1, windowMs: 40, leaseMs: 500 }), "tpm");
    await finishRisk(permit, 1); await new Promise((r) => setTimeout(r, 70));
    const next = await admitRisk({ dimensions, tokens: 10, windowMs: 40, leaseMs: 500 }); await finishRisk(next, 0);
  });
  await check("Rejected multi-dimension admissions leave other quotas untouched", async () => {
    await admitRisk({ dimensions: [dimension("endpoint", 0, 1)], tokens: 1 });
    await limited(admitRisk({ dimensions: [dimension("user", 5, 100), dimension("endpoint", 0, 1)], tokens: 1 }), "tpm", "endpoint");
    assert.equal(await redis.zCard(`${riskNamespace()}:user:fixture:rpm`), 0); assert.equal(await redis.get(`${riskNamespace()}:user:fixture:total`), null);
  });
  await check("100 simultaneous Redis admissions hold exactly 10 concurrency slots", async () => {
    const options = { dimensions: [dimension("key", 0, 1000)], tokens: 1, concurrency: 10, concurrencyKey: "hundred" };
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => admitRisk(options)));
    const permits = results.filter((r): r is PromiseFulfilledResult<RiskPermit> => r.status === "fulfilled").map((r) => r.value);
    assert.equal(permits.length, 10); assert.equal(await redis.zCard(`${riskNamespace()}:concurrency:hundred`), 10);
    for (const r of results) if (r.status === "rejected") assert(r.reason instanceof RiskLimited && r.reason.reason === "concurrency");
    await Promise.all(permits.map((p) => finishRisk(p, 0))); assert.equal(await redis.zCard(`${riskNamespace()}:concurrency:hundred`), 0);
    await finishRisk(await admitRisk(options), 0);
  });
  await check("Abandoned concurrency leases expire without permanent lockout", async () => {
    const options = { dimensions: [dimension("key")], concurrencyKey: "crash", concurrency: 1, leaseMs: 40, windowMs: 40 };
    await admitRisk(options); await limited(admitRisk(options), "concurrency"); await new Promise((r) => setTimeout(r, 70)); await finishRisk(await admitRisk(options), 0);
  });
  await check("Upstash HTTPS REST executes the same atomic Redis Lua contract", async () => {
    const originalFetch = globalThis.fetch, token = randomBytes(32).toString("hex");
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test"; process.env.UPSTASH_REDIS_REST_TOKEN = token;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://redis.example.test/"); assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
      const [command, script, count, ...args] = JSON.parse(String(init?.body)) as string[];
      assert.equal(command, "EVAL"); const n = Number(count);
      return Response.json({ result: await redis.eval(script, { keys: args.slice(0, n), arguments: args.slice(n) }) });
    };
    try {
      const p = await admitRisk({ dimensions: [dimension("user", 1)] }); await limited(admitRisk({ dimensions: [dimension("user", 1)] }), "rpm"); await finishRisk(p, 0);
      process.env.UPSTASH_REDIS_REST_URL = "http://redis.example.test"; await assert.rejects(evalRisk("return 1", [], []), RiskUnavailable);
    } finally { globalThis.fetch = originalFetch; process.env.UPSTASH_REDIS_REST_URL = ""; process.env.UPSTASH_REDIS_REST_TOKEN = ""; }
  });
  await check("RPM across two application processes and multiple keys cannot bypass a user limit", async () => {
    const owner = owners[0];
    for (let offset = 0; offset < 60; offset += 5) {
      const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => chat({ key: owner.keys[(offset + i) % 3].secret, server: i % 2 })));
      for (const response of responses) await result(response, 200);
    }
    const before = await db.wallet.findUniqueOrThrow({ where: { userId: owner.id } }), count = calls;
    const id = await result(await chat({ key: owner.keys[1].secret, server: 1 }), 429, "rate_limit_exceeded");
    assert.equal(calls, count); await walletUnchanged(owner.id, before);
    const saved = await db.apiRequest.findUniqueOrThrow({ where: { requestId: id } }); assert.equal(saved.status, "FAILED"); assert.equal(saved.reservedAmount.toFixed(), "0");
  });
  await check("Cross-process concurrency blocks excess upstream calls and releases all slots", async () => {
    const pending = Array.from({ length: 20 }, (_, i) => chat({ model: models.held.slug, server: i % 2 }));
    await waitFor(() => heldReplies.length === 10);
    let rejected = 0;
    const observed = pending.map(async (p) => { const r = await p; if (r.status === 429) rejected++; return r; });
    await waitFor(() => rejected === 10);
    assert.equal(await redis.zCard(`${riskNamespace()}:concurrency:${owners[0].keys[0].id}`), 10);
    const live = await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } }); assert(live.reservedBalance.gt(0));
    heldReplies.splice(0).forEach((send) => send());
    const responses = await Promise.all(observed);
    for (const r of responses) await result(r, r.status, r.status === 429 ? "rate_limit_exceeded" : undefined);
    assert.equal(responses.filter((r) => r.status === 200).length, 10);
    assert.equal(await redis.zCard(`${riskNamespace()}:concurrency:${owners[0].keys[0].id}`), 0);
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } })).reservedBalance.toFixed(), "0");
  });
  await check("TPM rejects before a wallet hold and reconciles real usage after completion", async () => {
    const body = { model: models.held.slug, messages: [{ role: "user", content: "a".repeat(30000) }], max_tokens: 30000 };
    const pending = [chat({ body }), chat({ body, server: 1 }), chat({ body })]; await waitFor(() => heldReplies.length === 3);
    const before = await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } }), count = calls;
    await result(await chat({ body, server: 1 }), 429, "rate_limit_exceeded"); await walletUnchanged(owners[0].id, before); assert.equal(calls, count);
    heldReplies.splice(0).forEach((send) => send()); for (const response of await Promise.all(pending)) await result(response, 200);
    assert.equal(await redis.get(`${riskNamespace()}:user:chat-completions:${owners[0].id}:total`), "9");
    await result(await chat({ body: { ...body, model: models.success.slug } }), 200);
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } })).reservedBalance.toFixed(), "0");
  });
  await check("Body byte limits cover both Content-Length and streamed/chunked input", async () => {
    const count = calls, before = await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } });
    await result(await chat({ raw: " ".repeat(262145) }), 413, "invalid_request");
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < 9; i++) controller.enqueue(new TextEncoder().encode(" ".repeat(32768))); controller.close(); } });
    const response = await fetch(`${origins[0]}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${owners[0].keys[0].secret}`, "Content-Type": "application/json", "x-aihub-client-ip": "192.0.2.1" }, body, duplex: "half", signal: AbortSignal.timeout(10000) } as RequestInit);
    await result(response, 413, "invalid_request"); assert.equal(calls, count); await walletUnchanged(owners[0].id, before);
  });
  await check("Message count, single/total input length and malicious output budgets are rejected", async () => {
    const count = calls, before = await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } });
    const invalid = [
      { messages: Array.from({ length: 65 }, () => ({ role: "user", content: "x" })) },
      { messages: [{ role: "user", content: "x".repeat(32769) }] },
      { messages: Array.from({ length: 5 }, () => ({ role: "user", content: "x".repeat(27000) })) },
      ...[0, -1, 1.1, 32769, 2147483647, 1e100].map((max_tokens) => ({ max_tokens })),
      { max_completion_tokens: 32769 }, { max_completion_tokens: 1, max_tokens: 1 },
    ];
    for (const change of invalid) await result(await chat({ body: { model: models.success.slug, messages: [{ role: "user", content: "Hi" }], ...change } }), 400, "invalid_request");
    assert.equal(calls, count); await walletUnchanged(owners[0].id, before);
  });
  await check("Repeated invalid keys are limited by IP without logging the supplied secrets", async () => {
    const count = calls;
    for (let i = 0; i < 10; i++) await result(await chat({ key: `sk-aihub-${randomBytes(32).toString("base64url")}`, server: i % 2 }), 401, "invalid_api_key");
    await result(await chat({ key: "invalid", server: 1 }), 429, "rate_limit_exceeded"); assert.equal(calls, count);
    await result(await chat({ key: "invalid", ip: "192.0.2.2" }), 401, "invalid_api_key");
    await result(await chat(), 200); // No account suspension or permanent ban.
    assert(serverOutput.includes('"reason":"invalid_api_key"'));
  });
  await check("Provider header and body timeouts abort, release balance and remain idempotent", async () => {
    for (const mode of ["timeout", "slow-body"]) {
      const before = await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } }), ended = aborted;
      const id = await result(await chat({ model: models[mode].slug }), 504, "provider_timeout");
      await walletUnchanged(owners[0].id, before); await waitFor(() => aborted > ended);
      const record = await db.apiRequest.findUniqueOrThrow({ where: { requestId: id } }); assert.equal(record.status, "FAILED"); assert.equal(record.userCost?.toFixed(), "0"); assert(record.settledAt);
      assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 0);
      await settleFailure(owners[0].id, id, "provider_timeout", 1); await walletUnchanged(owners[0].id, before);
      assert.equal(await redis.zCard(`${riskNamespace()}:concurrency:${owners[0].keys[0].id}`), 0);
    }
  });
  await check("Provider failure bursts generate safe risk signals without charging wallets", async () => {
    const before = await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } });
    for (let i = 0; i < 20; i++) await result(await chat({ model: models.failed.slug, server: i % 2 }), 502, "provider_unavailable");
    await walletUnchanged(owners[0].id, before);
    assert(serverOutput.includes('"reason":"provider_failures"')); assert(serverOutput.includes('"reason":"failed_requests"'));
  });
  await check("Redis outage fails closed before upstream work or freezing balance", async () => {
    const before = await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } }), count = calls;
    await result(await chat({ server: 2 }), 503, "risk_unavailable"); assert.equal(calls, count); await walletUnchanged(owners[0].id, before);
    const r = await mutation("/api/auth/login", { email: "none@example.test", password: passwordSecret }, { server: 2 }); assert.equal(r.status, 503);
  });
  await check("Login and registration enforce strict IP limits across application processes", async () => {
    for (const [path, limit] of [["login", 10], ["register", 5]] as const) {
      for (let i = 0; i < limit; i++) { const r = await mutation(`/api/auth/${path}`, {}, { server: i % 2 }); assert.equal(r.status, 422); await r.body?.cancel(); }
      const r = await mutation(`/api/auth/${path}`, {}, { server: 1 }); assert.equal(r.status, 429); assert(Number(r.headers.get("retry-after")) >= 1);
      const body = await r.json(); assert.equal(body.code, "rate_limit_exceeded"); assert.equal(typeof body.error, "string");
    }
  });
  await check("API key creation is limited by user even if IP changes; high frequency is logged", async () => {
    for (let i = 0; i < 10; i++) { const r = await mutation("/api/api-keys", { name: "Risk creation" }, { cookie: owners[1].cookie, ip: `192.0.2.${i + 10}`, server: i % 2 }); assert.equal(r.status, 201); await r.body?.cancel(); }
    const count = await db.apiKey.count({ where: { userId: owners[1].id } });
    const r = await mutation("/api/api-keys", { name: "Blocked creation" }, { cookie: owners[1].cookie, ip: "192.0.2.40" }); assert.equal(r.status, 429);
    assert.equal(await db.apiKey.count({ where: { userId: owners[1].id } }), count); assert(serverOutput.includes('"reason":"key_creation_burst"'));
  });
  await check("Payment creation and reserved password reset endpoints are IP limited", async () => {
    const before = await db.wallet.findUniqueOrThrow({ where: { userId: owners[0].id } });
    for (let i = 0; i < 10; i++) { const r = await mutation("/api/payments", { method: "ALIPAY", amount: "5.00" }, { cookie: owners[0].cookie, server: i % 2 }); assert.equal(r.status, 503); await r.body?.cancel(); }
    const payment = await mutation("/api/payments", { method: "ALIPAY", amount: "5.00" }, { cookie: owners[0].cookie }); assert.equal(payment.status, 429);
    assert.equal(await db.paymentOrder.count({ where: { userId: owners[0].id } }), 0); await walletUnchanged(owners[0].id, before);
    assert(serverOutput.includes('"reason":"payment_creation_burst"'));
    for (let i = 0; i < 3; i++) { const r = await mutation("/api/auth/password-reset", { email: "nobody@example.test" }, { server: i % 2 }); assert.equal(r.status, 501); await r.body?.cancel(); }
    assert.equal((await mutation("/api/auth/password-reset", { email: "nobody@example.test" })).status, 429);
  });
  await check("Audit logs whitelist metadata and never contain keys, prompts, responses or raw IPs", async () => {
    for (const secret of [upstreamKey, promptSecret, responseSecret, passwordSecret, ...owners.flatMap((u) => u.keys.map((k) => k.secret)), "192.0.2.", process.env.REDIS_URL!]) assert(!serverOutput.includes(secret));
    const output: string[] = [], original = console.info;
    console.info = (value: string) => { output.push(value); };
    try { riskLog({ event: "api_request", requestId: randomUUID(), userId: owners[0].id, apiKeyPrefix: owners[0].keys[0].prefix, ipHash: "a".repeat(64), status: 200, tokens: 3, cost: "0.0000048", ...({ password: passwordSecret, prompt: promptSecret, response: responseSecret, secret: upstreamKey } as object) }); }
    finally { console.info = original; }
    assert.equal(output.length, 1); assert(!output[0].includes(passwordSecret)); assert(!output[0].includes(promptSecret)); assert(!output[0].includes(upstreamKey)); assert(output[0].includes(owners[0].keys[0].prefix));
  });
  await check("Rate rejections and provider failures reconcile wallets and ledgers without negative balances", async () => {
    for (const owner of owners) {
      const wallet = await db.wallet.findUniqueOrThrow({ where: { userId: owner.id } }); assert(!wallet.balance.isNegative()); assert.equal(wallet.reservedBalance.toFixed(), "0");
      const ledger = await db.walletTransaction.aggregate({ where: { walletId: wallet.id }, _sum: { amount: true } });
      assert.equal(wallet.balance.toFixed(20), money("10").plus(money(ledger._sum.amount ?? "0")).toFixed(20));
      assert.equal(await db.apiRequest.count({ where: { userId: owner.id, status: "PENDING" } }), 0);
    }
  });
  console.log(`API risk integration: ${passed} checks passed.`);
}
async function run() {
try { await main(); }
catch { console.error(`FAIL ${activeCheck}. Sensitive request values and runtime output were withheld.`); process.exitCode = 1; }
finally {
  heldReplies.splice(0).forEach((send) => send());
  for (const child of children) if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]); }
  fixtureServer.closeAllConnections(); if (fixtureServer.listening) await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  await closeRiskRedis(); if (redis.isOpen) redis.destroy(); await risk.cleanup();
  await db.user.deleteMany({ where: { id: { in: owners.map((u) => u.id) } } }); await db.model.deleteMany({ where: { id: { in: modelIds } } });
  await risk.cleanupRouting(db);
  await db.$disconnect(); await getDb().$disconnect();
}
}
void run().catch(() => { console.error("Risk test cleanup failed; sensitive diagnostics were withheld."); process.exitCode = 1; });
