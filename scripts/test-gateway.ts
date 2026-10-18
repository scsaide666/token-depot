import { riskTestEnvironment } from "./risk-test-environment";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { calculateCosts, money } from "../lib/billing/money";

config({ quiet: true });
const risk = riskTestEnvironment("gateway");
Object.assign(process.env, risk.env);
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) throw new Error("Configure the isolated DATABASE_URL_TEST first.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test", "Tests require the local aihub_auth_test database.");
assert(databaseUrl !== process.env.DATABASE_URL, "Tests must not use the development database.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 4 }), log: [] });
const origin = "http://127.0.0.1:3104", fixtureOrigin = "http://127.0.0.1:3105";
// Synthetic credentials only. This suite cannot call a real provider or spend credits.
const upstreamKey = `fixture-upstream-${randomBytes(20).toString("hex")}`;
const deepseekKey = `fixture-deepseek-${randomBytes(20).toString("hex")}`;
const env: NodeJS.ProcessEnv = {
  ...process.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, NODE_ENV: "production",
  OPENAI_API_KEY: upstreamKey, OPENAI_BASE_URL: `${fixtureOrigin}/v1`, OPENAI_TIMEOUT_MS: "300", GATEWAY_REQUESTS_PER_MINUTE: "100",
  ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "",
  DEEPSEEK_API_KEY: deepseekKey, DEEPSEEK_BASE_URL: `${fixtureOrigin}/v1`, DEEPSEEK_TIMEOUT_MS: "300",
};
const seed = randomBytes(8).toString("hex"), emails = [`gateway-a-${seed}@example.test`, `gateway-b-${seed}@example.test`];
const password = `Test-only-${randomBytes(16).toString("hex")}`;
const userIds: string[] = [], modelIds: string[] = [];
let server: ChildProcess | undefined, passed = 0, redirected = 0;
let serverOutput = "";
let activeCheck = "startup";
const calls: { headers: IncomingHttpHeaders; body: Record<string, unknown>; path: string | undefined }[] = [];
const validUsage = { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, completion_tokens_details: { reasoning_tokens: 3 } };
const fixtureServer = createServer(async (request, response) => {
  if (request.url !== "/v1/chat/completions") { redirected++; response.writeHead(200).end(); return; }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  calls.push({ headers: request.headers, body, path: request.url });
  const mode = String(body.model).replace(`upstream-${seed}-`, "");
  const payload: Record<string, unknown> = {
    id: "private-upstream-request-id", object: "chat.completion", model: body.model, created: 1,
    choices: [{ index: 0, message: { role: "assistant", content: "Hello from fixture", debug: upstreamKey }, finish_reason: "stop" }],
    usage: validUsage, debug: { key: upstreamKey, providerCost: "0.1" },
  };
  if (["fail", "auth", "rate"].includes(mode)) {
    response.writeHead(mode === "rate" ? 429 : mode === "auth" ? 401 : 500, { "Content-Type": "application/json", "X-Secret": upstreamKey });
    response.end(JSON.stringify({ error: { message: `private provider error ${upstreamKey}`, code: "private_code" } })); return;
  }
  if (mode === "redirect") { response.writeHead(302, { Location: `${fixtureOrigin}/stolen` }).end(); return; }
  if (mode === "timeout") { setTimeout(() => { if (!response.destroyed) response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload)); }, 1000); return; }
  if (mode === "bad-json") { response.writeHead(200, { "Content-Type": "application/json" }).end("{invalid"); return; }
  if (mode === "html") { response.writeHead(200, { "Content-Type": "text/html" }).end("private error"); return; }
  if (mode === "oversized") { response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "5242880" }).end("{}"); return; }
  if (mode === "missing-usage") delete payload.usage;
  if (mode === "negative-usage") payload.usage = { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 };
  if (mode === "fractional-usage") payload.usage = { prompt_tokens: 1.5, completion_tokens: 1.5, total_tokens: 3 };
  if (mode === "inconsistent-usage") payload.usage = { prompt_tokens: 12, completion_tokens: 7, total_tokens: 22 };
  if (mode === "overflow-usage") payload.usage = { prompt_tokens: 2147483647, completion_tokens: 1, total_tokens: 2147483648 };
  if (mode === "bad-choice") payload.choices = [];
  if (mode === "reflection") payload.choices = [{ index: 0, message: { role: "assistant", content: `hello ${upstreamKey}`, refusal: upstreamKey }, finish_reason: "stop" }];
  response.writeHead(200, { "Content-Type": "application/json", "X-Secret": upstreamKey }).end(JSON.stringify(payload));
});

type Identity = { id: string; cookie: string };
type Key = { id: string; secret: string };
type GatewayBody = { model: string; object: string; choices: { message: { content: string; refusal?: string } }[]; usage: typeof validUsage; error?: { message: string; type: string; code: string } };
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); passed++; console.log(`PASS ${name}`); }
async function ui(path: string, method: string, cookie?: string, body?: unknown) {
  return fetch(`${origin}${path}`, { method, redirect: "manual", signal: AbortSignal.timeout(15000), headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}) });
}
async function register(email: string): Promise<Identity> {
  const response = await ui("/api/auth/register", "POST", undefined, { name: "Gateway Test", email, password, confirmPassword: password });
  assert.equal(response.status, 201);
  const { user } = await response.json() as { user: { id: string } }; userIds.push(user.id);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Host-aihub-session="))?.split(";")[0]; assert(cookie);
  return { id: user.id, cookie };
}
async function key(user: Identity): Promise<Key> {
  const response = await ui("/api/api-keys", "POST", user.cookie, { name: "Gateway fixture" }); assert.equal(response.status, 201);
  const result = await response.json() as { apiKey: { id: string }; key: string }; return { id: result.apiKey.id, secret: result.key };
}
async function model(mode: string, extra: { enabled?: boolean; provider?: "ANTHROPIC" | "DEEPSEEK" } = {}) {
  const result = await db.model.create({ data: {
    slug: `gateway-${seed}-${mode}`, name: "Gateway fixture", provider: "OPENAI", providerModel: `upstream-${seed}-${mode}`,
    description: "Isolated HTTP fixture", contextWindow: 4000, inputPricePerMillion: "0.12345678", outputPricePerMillion: "0.87654321", markupMultiplier: "1.2", ...extra,
  } }); modelIds.push(result.id); await risk.bindRouting(db, result, env); return result;
}
async function chat(secret: string | undefined, slug: string, options: { body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
  return fetch(`${origin}/v1/chat/completions`, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...options.headers },
    body: options.raw ?? JSON.stringify(options.body ?? { model: slug, messages: [{ role: "user", content: "Hello" }] }),
  });
}
async function result(response: Response, status: number, code?: string) {
  assert.equal(response.status, status, "Unexpected gateway response status.");
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const requestId = response.headers.get("x-request-id"); assert(requestId && /^[a-f0-9-]{36}$/.test(requestId));
  assert.equal(response.headers.get("x-secret"), null);
  const text = await response.text(); assert(!text.includes(upstreamKey), "Upstream secrets must never be returned.");
  const body = JSON.parse(text) as GatewayBody;
  if (code) { assert.equal(body.error?.code, code); assert.deepEqual(Object.keys(body), ["error"]); assert.deepEqual(Object.keys(body.error ?? {}).sort(), ["message", "type", "code"].sort()); }
  return { body, requestId };
}
async function saved(requestId: string) { return db.apiRequest.findUniqueOrThrow({ where: { requestId } }); }
async function lastUsed(id: string) { return (await db.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt; }

async function main() {
  for (const address of [origin, fixtureOrigin]) assert(await fetch(address, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Gateway test ports must be free.");
  try { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" }); } catch { throw new Error("Gateway test database migration failed."); }
  fixtureServer.listen(3105, "127.0.0.1"); await once(fixtureServer, "listening");
  const handle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3104"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); server = handle;
  const capture = (chunk: Buffer) => { serverOutput = (serverOutput + chunk.toString()).slice(-100000); }; handle.stdout?.on("data", capture); handle.stderr?.on("data", capture);
  let startupError = false; handle.on("error", () => { startupError = true; }); const deadline = Date.now() + 30000;
  while (!await ui("/api/auth/session", "GET").then((response) => response.status === 200).catch(() => false)) { if (startupError || handle.exitCode !== null || Date.now() > deadline) throw new Error("Gateway test server failed to start. Run build first."); await new Promise((resolve) => setTimeout(resolve, 250)); }
  const a = await register(emails[0]), b = await register(emails[1]);
  // Trusted fixture funding in the isolated database, never a payment endpoint.
  await db.wallet.updateMany({ where: { userId: { in: userIds } }, data: { balance: "10" } });
  const success = await model("success");
  await check("Valid platform key routes the public slug to the private provider model", async () => {
    const k = await key(a), prompt = `private-prompt-${seed}`;
    const output = await result(await chat(k.secret, success.slug, { body: { model: success.slug, messages: [{ role: "user", content: prompt }], max_completion_tokens: 8 }, headers: { Origin: "https://external-client.example", Cookie: b.cookie, "X-User-Id": b.id, "X-Request-Id": "untrusted" } }), 200);
    assert.equal(output.body.model, success.slug); assert.equal(output.body.object, "chat.completion"); assert.equal(output.body.choices[0].message.content, "Hello from fixture");
    assert.deepEqual(output.body.usage, { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 });
    assert.deepEqual(Object.keys(output.body).sort(), ["id", "object", "created", "model", "choices", "usage"].sort());
    const call = calls.at(-1)!; assert.equal(call.body.model, success.providerModel); assert.equal(call.headers.authorization, `Bearer ${upstreamKey}`); assert.equal(call.headers.cookie, undefined); assert.equal(call.headers["x-user-id"], undefined); assert.equal(call.body.store, false); assert.equal(call.body.stream, false);
    const record = await saved(output.requestId); assert.equal(record.userId, a.id); assert.equal(record.apiKeyId, k.id); assert.equal(record.modelId, success.id); assert.equal(record.provider, "OPENAI"); assert.equal(record.status, "SUCCESS"); assert.equal(record.inputTokens, 12); assert.equal(record.outputTokens, 7); assert.equal(record.totalTokens, 19); assert.equal(record.errorCode, null); assert(record.latencyMs >= 0); assert(await lastUsed(k.id));
    const stored = JSON.stringify(record); for (const secret of [k.secret, upstreamKey, prompt, "Hello from fixture"]) assert(!stored.includes(secret));
    const refreshed = await ui("/api/api-keys", "GET", a.cookie); const text = await refreshed.text(); assert(!text.includes(k.secret)); assert(text.includes("lastUsedAt"));
  });
  await check("Invalid, missing, revoked, expired and deleted keys fail before the provider", async () => {
    const before = calls.length;
    for (const secret of [undefined, "wrong", `sk-aihub-${randomBytes(32).toString("base64url")}`]) { const output = await result(await chat(secret, success.slug), 401, "invalid_api_key"); assert.equal(await db.apiRequest.count({ where: { requestId: output.requestId } }), 0); }
    for (const state of ["revoked", "expired", "deleted"] as const) { const k = await key(a); if (state === "deleted") await db.apiKey.delete({ where: { id: k.id } }); else await db.apiKey.update({ where: { id: k.id }, data: state === "revoked" ? { revokedAt: new Date() } : { expiresAt: new Date(Date.now() - 1000) } }); await result(await chat(k.secret, success.slug), 401, "invalid_api_key"); if (state !== "deleted") assert.equal(await lastUsed(k.id), null); }
    const k = await key(a); await result(await chat(undefined, success.slug, { headers: { Cookie: a.cookie, Authorization: `Basic ${k.secret}` } }), 401, "invalid_api_key");
    assert.equal(calls.length, before);
  });
  await check("Suspension is rechecked per request and returns account_suspended", async () => {
    const k = await key(b), before = calls.length; await db.user.update({ where: { id: b.id }, data: { status: "SUSPENDED" } });
    const output = await result(await chat(k.secret, success.slug), 403, "account_suspended"); const record = await saved(output.requestId); assert.equal(record.userId, b.id); assert.equal(record.status, "FAILED"); assert.equal(record.totalTokens, null); assert.equal(await lastUsed(k.id), null); assert.equal(calls.length, before);
    await db.user.update({ where: { id: b.id }, data: { status: "ACTIVE" } }); await result(await chat(k.secret, success.slug), 200);
  });
  await check("Missing and disabled models cannot reach the provider", async () => {
    const k = await key(a), disabled = await model("disabled", { enabled: false }), before = calls.length;
    for (const slug of [`missing-${seed}`, disabled.slug]) { const output = await result(await chat(k.secret, slug), 404, "model_not_found"); const record = await saved(output.requestId); assert.equal(record.status, "FAILED"); assert.equal(record.totalTokens, null); }
    assert.equal(await lastUsed(k.id), null); assert.equal(calls.length, before);
  });
  await check("Unconfigured providers fail safely without borrowing another provider's credential", async () => {
    const k = await key(a), unsupported = await model("unsupported", { provider: "ANTHROPIC" }), before = calls.length;
    const output = await result(await chat(k.secret, unsupported.slug), 503, "provider_not_configured"); assert.equal((await saved(output.requestId)).provider, "ANTHROPIC"); assert.equal(calls.length, before); assert.equal(await lastUsed(k.id), null);
  });
  await check("DeepSeek uses isolated credentials and compatible text parameters with persisted usage", async () => {
    const k = await key(a), m = await model("deepseek-success", { provider: "DEEPSEEK" });
    const output = await result(await chat(k.secret, m.slug, { body: { model: m.slug, messages: [{ role: "developer", content: "Be brief." }, { role: "user", content: "Hello" }], max_completion_tokens: 8, n: 1 } }), 200);
    const call = calls.at(-1)!;
    assert.equal(call.headers.authorization, `Bearer ${deepseekKey}`); assert.notEqual(call.headers.authorization, `Bearer ${upstreamKey}`);
    assert.equal(call.body.model, m.providerModel); assert.equal(call.body.max_tokens, 8); assert.equal(call.body.max_completion_tokens, undefined); assert.equal(call.body.store, undefined); assert.equal(call.body.n, undefined);
    assert.deepEqual(call.body.thinking, { type: "disabled" }); assert.deepEqual(call.body.messages, [{ role: "system", content: "Be brief." }, { role: "user", content: "Hello" }]);
    const record = await saved(output.requestId); assert.equal(record.provider, "DEEPSEEK"); assert.equal(record.status, "SUCCESS"); assert.equal(record.totalTokens, 19); assert(await lastUsed(k.id));
    const standard = await result(await chat(k.secret, m.slug, { body: { model: m.slug, messages: [{ role: "user", content: "Hello" }], max_tokens: 10 } }), 200);
    assert.equal(calls.at(-1)!.body.max_tokens, 10); assert.equal((await saved(standard.requestId)).provider, "DEEPSEEK");
    for (const mode of ["fail", "rate"]) {
      const target = await model(`deepseek-${mode}`, { provider: "DEEPSEEK" });
      // Keep the fixture's explicit compatible binding in sync with its canonical ID.
      await db.$transaction([
        db.model.update({ where: { id: target.id }, data: { providerModel: `upstream-${seed}-${mode}` } }),
        db.modelChannel.updateMany({ where: { modelId: target.id }, data: { providerModel: `upstream-${seed}-${mode}` } }),
      ]);
      const output = await result(await chat(k.secret, target.slug), mode === "rate" ? 429 : 502, mode === "rate" ? "provider_rate_limit" : "provider_unavailable"); assert.equal((await saved(output.requestId)).provider, "DEEPSEEK");
    }
  });
  await check("Validation rejects invalid stream flags, unknown identity/routing fields and invalid bodies", async () => {
    const k = await key(a), before = calls.length;
    for (const change of [{ userId: b.id }, { providerModel: "injected" }, { baseURL: fixtureOrigin }, { temperature: 3 }, { n: 2 }, { max_tokens: 1, max_completion_tokens: 1 }, { messages: [] }, { messages: [{ role: "tool", content: "hello" }] }]) await result(await chat(k.secret, success.slug, { body: { model: success.slug, messages: [{ role: "user", content: "Hello" }], ...change } }), 400, "invalid_request");
    await result(await chat(k.secret, success.slug, { body: { model: success.slug, messages: [{ role: "user", content: "Hello" }], stream: "true" } }), 400, "invalid_request");
    await result(await chat(k.secret, success.slug, { raw: "{invalid" }), 400, "invalid_request");
    await result(await chat(k.secret, success.slug, { headers: { "Content-Type": "text/plain" } }), 415, "invalid_request");
    await result(await chat(k.secret, success.slug, { raw: " ".repeat(1024 * 1024 + 1) }), 413, "invalid_request");
    assert.equal(calls.length, before); assert.equal(await lastUsed(k.id), null);
  });
  await check("Upstream failures and rate limits are normalized, logged and mark Last Used", async () => {
    for (const mode of ["fail", "auth", "rate"]) {
      const k = await key(a), m = await model(mode);
      const response = await chat(k.secret, m.slug); if (mode === "rate") assert.equal(response.headers.get("retry-after"), "60");
      const output = await result(response, mode === "rate" ? 429 : 502, mode === "rate" ? "provider_rate_limit" : mode === "auth" ? "provider_auth_error" : "provider_unavailable");
      const record = await saved(output.requestId); assert.equal(record.status, "FAILED"); assert.equal(record.errorCode, output.body.error?.code); assert.equal(record.totalTokens, null); assert(await lastUsed(k.id));
    }
  });
  await check("Missing, fractional, negative, overflowing and inconsistent usage never becomes zero", async () => {
    for (const mode of ["missing-usage", "negative-usage", "fractional-usage", "overflow-usage", "inconsistent-usage"]) {
      const k = await key(a), m = await model(mode); const output = await result(await chat(k.secret, m.slug), 502, "provider_unavailable");
      const record = await saved(output.requestId); assert.equal(record.inputTokens, null); assert.equal(record.outputTokens, null); assert.equal(record.totalTokens, null);
    }
  });
  await check("Known token usage survives an invalid completion response", async () => {
    const k = await key(a), m = await model("bad-choice"); const output = await result(await chat(k.secret, m.slug), 502, "provider_unavailable");
    const record = await saved(output.requestId); assert.equal(record.status, "FAILED"); assert.equal(record.totalTokens, 19);
  });
  await check("Timeouts, malformed and oversized upstream responses fail safely; redirects cannot leak keys", async () => {
    for (const mode of ["timeout", "bad-json", "html", "oversized", "redirect"]) {
      const k = await key(a), m = await model(mode); const output = await result(await chat(k.secret, m.slug), mode === "timeout" ? 504 : 502, mode === "timeout" ? "provider_timeout" : "provider_unavailable"); assert.equal((await saved(output.requestId)).totalTokens, null); assert(await lastUsed(k.id));
    }
    assert.equal(redirected, 0);
  });
  await check("Response projection strips private metadata and redacts reflected credentials", async () => {
    const k = await key(a), m = await model("reflection"); const output = await result(await chat(k.secret, m.slug), 200);
    assert.equal(output.body.choices[0].message.content, "hello [REDACTED]"); assert.equal(output.body.choices[0].message.refusal, "[REDACTED]");
  });
  await check("Redis rolling rate limit is atomic under concurrent requests and failures are recorded", async () => {
    const k = await key(a);
    await risk.seedRpm(k.id, 98);
    const outputs = await Promise.all(Array.from({ length: 5 }, () => chat(k.secret, success.slug)));
    assert.equal(outputs.filter((response) => response.status === 200).length, 2); assert.equal(outputs.filter((response) => response.status === 429).length, 3);
    for (const response of outputs) { if (response.status === 429) assert(Number(response.headers.get("retry-after")) >= 1); const output = await result(response, response.status, response.status === 429 ? "rate_limit_exceeded" : undefined); const record = await saved(output.requestId); assert.equal(record.status, response.status === 200 ? "SUCCESS" : "FAILED"); }
  });
  await check("Deleting a key retains usage history and the ledger reconciles exact charges", async () => {
    const k = await key(a); const output = await result(await chat(k.secret, success.slug), 200);
    const response = await ui(`/api/api-keys/${k.id}`, "DELETE", a.cookie); assert.equal(response.status, 200);
    assert.equal((await saved(output.requestId)).apiKeyId, null); assert.equal((await saved(output.requestId)).userId, a.id);
    for (const userId of userIds) {
      const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
      const entries = await db.walletTransaction.findMany({ where: { walletId: wallet.id } });
      const total = entries.reduce((sum, entry) => sum.plus(money(entry.amount)), money("0"));
      assert.equal(wallet.balance.toFixed(20), money("10").plus(total).toFixed(20)); assert.equal(wallet.reservedBalance.toFixed(), "0");
      const requests = await db.apiRequest.findMany({ where: { userId, status: "SUCCESS" } }); assert.equal(requests.length, entries.length);
      for (const request of requests) {
        assert(request.settledAt); assert.equal(request.userCost?.toFixed(20), calculateCosts(request.inputTokens!, request.outputTokens!, { inputPricePerMillion: request.inputPricePerMillion!, outputPricePerMillion: request.outputPricePerMillion!, markupMultiplier: request.markupMultiplier! }).userCost);
      }
    }
  });
  await check("Database constraints enforce accurate usage and the schema contains no prompt or secret columns", async () => {
    const columns = await db.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'ApiRequest'`;
    assert.deepEqual(columns.map((column) => column.column_name).sort(), ["id", "requestId", "userId", "source", "apiKeyId", "modelId", "provider", "inputTokens", "outputTokens", "totalTokens", "status", "latencyMs", "errorCode", "createdAt", "providerCost", "providerCostStatus", "userCost", "reservedAmount", "settledAt", "modelSlug", "inputPricePerMillion", "outputPricePerMillion", "markupMultiplier", "estimatedInputTokens", "maxOutputTokens", "modelContextWindow", "reservationExpiresAt"].sort());
    const k = await key(a);
    const base = { requestId: randomUUID(), userId: a.id, apiKeyId: k.id, status: "SUCCESS" as const, latencyMs: 1, inputTokens: 12, outputTokens: 7, totalTokens: 19 };
    for (const patch of [{ totalTokens: 20 }, { inputTokens: -1, totalTokens: 6 }, { totalTokens: null }, { latencyMs: -1 }, { errorCode: "invalid_result" }]) await assert.rejects(db.apiRequest.create({ data: { ...base, ...patch } }), "Invalid request record must fail.");
    const stored = JSON.stringify(await db.apiRequest.findMany({ where: { userId: { in: userIds } } })); assert(!stored.includes(upstreamKey)); assert(!stored.includes(deepseekKey)); assert(!stored.includes("private-prompt-")); assert(!stored.includes("Hello from fixture")); assert(!serverOutput.includes(upstreamKey)); assert(!serverOutput.includes(deepseekKey));
  });
  console.log(`Gateway integration checks: ${passed} passed (local HTTP fixture, no live provider).`);
}

async function run() {
  try { await main(); } catch { console.error(`FAIL ${activeCheck}. No credentials or response bodies were printed.`); process.exitCode = 1; }
  finally {
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    if (fixtureServer.listening) { fixtureServer.closeAllConnections(); await new Promise<void>((resolve) => fixtureServer.close(() => resolve())); }
    await db.user.deleteMany({ where: { id: { in: userIds }, email: { in: emails } } }).catch(() => { console.error("Gateway user cleanup failed."); process.exitCode = 1; });
    await db.model.deleteMany({ where: { id: { in: modelIds } } }).catch(() => { console.error("Gateway model cleanup failed."); process.exitCode = 1; });
    const keys = emails.flatMap((email) => ["register", "login"].map((action) => createHash("sha256").update(`${action}:${email}`).digest("hex")));
    await db.authRateLimit.deleteMany({ where: { key: { in: keys } } }).catch(() => { console.error("Gateway rate-limit cleanup failed."); process.exitCode = 1; });
    await risk.cleanup();
    await risk.cleanupRouting(db);
    await db.$disconnect();
  }
}
void run().catch(() => { console.error("Gateway cleanup failed."); process.exitCode = 1; });
