import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Model } from "../generated/prisma/client";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { getDb } from "../lib/server/db";
import { money } from "../lib/billing/money";
import { reserveRequest, settleSuccess, settleFailure } from "../lib/billing/wallet";
import { claimAttempt, finishAttempt, markDispatched } from "../lib/ai/router/attempts";
import { retryDecision } from "../lib/ai/router/retry";
import { GatewayError } from "../lib/ai/types";
import { riskTestEnvironment } from "./risk-test-environment";
import type { ChannelInput, BindingInput } from "../lib/provider-schemas";
import type { ProviderPageData } from "../lib/provider-types";

config({ quiet: true });
const risk = riskTestEnvironment("routing"), testUrl = process.env.DATABASE_URL_TEST;
assert(testUrl && testUrl !== process.env.DATABASE_URL && new URL(testUrl).pathname === "/aihub_auth_test" && ["127.0.0.1", "localhost"].includes(new URL(testUrl).hostname));
Object.assign(process.env, risk.env, { DATABASE_URL: testUrl });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl, max: 6, options: "-c timezone=UTC" }), log: [] });
const seed = randomBytes(6).toString("hex"), origins = ["http://127.0.0.1:3140", "http://127.0.0.1:3141"], fixtureOrigin = "http://127.0.0.1:3142";
const fixtureKey = `fixture-routing-${randomBytes(20).toString("hex")}`, prompt = `private-routing-prompt-${seed}`;
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testUrl, NODE_ENV: "production", PAYMENTS_ENABLED: "false", ROUTER_MAX_RETRIES: "2", GATEWAY_API_KEY_RPM: "100000",
  OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", UPSTREAM_API_KEY: "", DEEPSEEK_API_KEY: fixtureKey, DEEPSEEK_BASE_URL: fixtureOrigin + "/legacy", DEEPSEEK_TIMEOUT_MS: "1000" };
for (const path of ["a", "b", "c"]) { env[`DEEPSEEK_HA${path.toUpperCase()}_API_KEY`] = fixtureKey; env[`DEEPSEEK_HA${path.toUpperCase()}_BASE_URL`] = fixtureOrigin + "/" + path; }
const children: ChildProcess[] = [], models: Model[] = [], channelIds: string[] = [], users: string[] = [];
const calls: { path: string; model: string; idempotencyKey?: string }[] = [], executions = new Set<string>(), replies: (() => void)[] = [], timers = new Set<NodeJS.Timeout>();
type Behavior = { mode: "success" | "rate" | "ambiguous-rate" | "fail" | "fail-known" | "timeout" | "partial" | "hold" | "idempotent" | "idempotent-rate" | "idempotent-rate-zero" | "invalid"; usage?: { input: number; output: number } };
const behaviors = new Map<string, Behavior>();
let output = "", activeCheck = "startup", passed = 0, owner: { id: string; keyId: string; key: string; cookie: string }, adminCookie = "", regularCookie = "";
function payload(usage = { input: 12, output: 7 }) {
  return { id: "private-upstream-id", model: "private-upstream-model", choices: [{ index: 0, message: { role: "assistant", content: "Local fixture response" }, finish_reason: "stop" }],
    usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } };
}
function send(response: ServerResponse, status: number, body: unknown) { if (!response.destroyed) response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body)); }
function after(response: ServerResponse, ms: number, reply: () => void) {
  const timer = setTimeout(() => { timers.delete(timer); reply(); }, ms); timers.add(timer);
  response.once("close", () => { clearTimeout(timer); timers.delete(timer); });
}
const fixture = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string };
    assert.equal(request.headers.authorization, `Bearer ${fixtureKey}`);
    assert.equal(request.headers.cookie, undefined);
    const path = (request.url ?? "").split("/")[1], mode = behaviors.get(`${path}:${body.model}`) ?? { mode: "success" };
    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    calls.push({ path, model: body.model, idempotencyKey });
    const error = { error: { code: "private_error", message: fixtureKey, prompt } };
    if (mode.mode === "rate") { response.setHeader("Retry-After", "1"); send(response, 429, { error: { code: "rate_limit_exceeded" } }); return; }
    if (mode.mode === "ambiguous-rate") { send(response, 429, error); return; }
    if (mode.mode === "fail") { send(response, 500, error); return; }
    if (mode.mode === "fail-known") { send(response, 500, { ...error, usage: payload().usage }); return; }
    if (mode.mode === "invalid") { send(response, 400, { error: { code: "invalid_request_error" } }); return; }
    if (mode.mode === "timeout" || mode.mode === "partial") {
      if (mode.mode === "partial") { response.writeHead(200, { "Content-Type": "application/json" }); response.write('{"partial":'); }
      after(response, 3000, () => send(response, 200, payload())); return;
    }
    if (mode.mode === "hold") { replies.push(() => send(response, 200, payload(mode.usage))); return; }
    if (["idempotent", "idempotent-rate", "idempotent-rate-zero"].includes(mode.mode)) {
      assert(idempotencyKey);
      const execution = `${path}:${body.model}:${idempotencyKey}`;
      if (!executions.has(execution)) { executions.add(execution); after(response, 3000, () => send(response, 200, payload())); return; }
      if (mode.mode !== "idempotent") {
        response.setHeader("Retry-After", "1"); send(response, 429, { error: { code: "rate_limit_exceeded" },
          ...(mode.mode === "idempotent-rate-zero" ? { usage: payload({ input: 0, output: 0 }).usage } : {}) }); return;
      }
    }
    send(response, 200, payload(mode.usage));
  } catch { send(response, 500, { error: { code: "fixture_error" } }); }
});
async function waitFor(predicate: () => boolean | Promise<boolean>, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!await predicate()) { assert(Date.now() < deadline, "Local fixture wait exceeded its deadline."); await new Promise(r => setTimeout(r, 20)); }
}
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); passed++; console.log(`PASS ${name}`); }
async function ui(path: string, method = "GET", body?: unknown, cookie = adminCookie, origin = origins[0]) {
  return fetch(origin + path, { method, redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function expect(response: Response, status: number) {
  const text = await response.text();
  assert.equal(response.status, status);
  for (const value of [fixtureKey, prompt, owner?.key, "private-upstream-id"]) if (value) assert(!text.includes(value), "Secrets, prompts and internal upstream IDs cannot be exposed.");
  return JSON.parse(text);
}
async function actor(role: "ADMIN" | "USER") {
  const row = await db.user.create({ data: { name: "Routing fixture", email: `routing-${seed}-${users.length}@example.test`, role, passwordHash: "test-only-unusable-password", wallet: { create: { balance: "10" } } } }); users.push(row.id);
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId: row.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), userAgent: "Local HA fixture" } });
  const secret = generateApiKey(), key = await db.apiKey.create({ data: { userId: row.id, name: "Routing fixture", keyHash: secret.keyHash, keyPrefix: secret.keyPrefix } });
  return { id: row.id, keyId: key.id, key: secret.key, cookie: `__Host-aihub-session=${token}` };
}
async function model() {
  const row = await db.model.create({ data: { slug: `routing-${seed}-${models.length}`, name: "Routing fixture", provider: "DEEPSEEK", providerModel: `compatible-${seed}-${models.length}`,
    description: "Synthetic compatible upstreams", contextWindow: 4096, inputPricePerMillion: "2", outputPricePerMillion: "8", markupMultiplier: "1.5" } }); models.push(row); return row;
}
async function channel(m: Model, path: "a" | "b" | "c", changes: Partial<ChannelInput> = {}, costs = { input: "0.1", output: "0.2" }) {
  const code = `routing-${seed}-${channelIds.length}`;
  const created = await expect(await ui("/api/admin/providers", "POST", { code, name: code, provider: "DEEPSEEK", apiKeyEnv: `DEEPSEEK_HA${path.toUpperCase()}_API_KEY`,
    baseUrlEnv: `DEEPSEEK_HA${path.toUpperCase()}_BASE_URL`, priority: path === "a" ? 10 : path === "b" ? 100 : 200, timeoutMs: 1000,
    rpm: 1000000, tpm: 1000000000, concurrency: 100, failureThreshold: 5, cooldownMs: 1000, ...changes }), 201);
  const id = created.channel.id as string; channelIds.push(id);
  await bind(id, m, { inputPricePerMillion: costs.input, outputPricePerMillion: costs.output });
  return id;
}
async function bind(id: string, m: Model, changes: Partial<BindingInput> = {}) {
  return expect(await ui(`/api/admin/providers/${id}/models`, "POST", { modelSlug: m.slug, providerModel: m.providerModel, contextWindow: m.contextWindow,
    inputPricePerMillion: "0.1", outputPricePerMillion: "0.2", enabled: true, preferred: false, ...changes }), 200);
}
function mode(m: Model, path: string, value: Behavior["mode"], usage?: Behavior["usage"]) { behaviors.set(`${path}:${m.providerModel}`, { mode: value, usage }); }
async function chat(m: Model, index = 0, extra: Record<string, unknown> = {}) {
  const response = await fetch(origins[index] + "/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(45000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.key}` },
    body: JSON.stringify({ model: m.slug, messages: [{ role: "user", content: prompt }], max_tokens: 16, ...extra }) });
  const requestId = response.headers.get("x-request-id"); assert(requestId);
  const body = await response.json(); assert(!JSON.stringify(body).includes(fixtureKey) && !JSON.stringify(body).includes(prompt));
  const record = await db.apiRequest.findUniqueOrThrow({ where: { requestId }, include: { attempts: { orderBy: { attemptNumber: "asc" } } } });
  assert.equal(record.userId, owner.id); assert.equal(record.apiKeyId, owner.keyId);
  return { status: response.status, body, record };
}
async function wallet() { return db.wallet.findUniqueOrThrow({ where: { userId: owner.id } }); }
async function noCharge(m: Model, status: number, code: string) {
  const before = await wallet(), result = await chat(m);
  assert.equal(result.status, status); assert.equal(result.body.error.code, code);
  assert(result.record.userCost === null || result.record.userCost.isZero()); assert.equal((await wallet()).balance.toFixed(20), before.balance.toFixed(20)); assert((await wallet()).reservedBalance.isZero());
  assert.equal(await db.walletTransaction.count({ where: { requestId: result.record.requestId } }), 0);
  return result;
}
async function warm(m: Model, a: string, b: string) {
  mode(m, "a", "success"); mode(m, "b", "success");
  await db.providerChannel.update({ where: { id: b }, data: { enabled: false } }); assert.equal((await chat(m)).status, 200);
  await db.providerChannel.update({ where: { id: b }, data: { enabled: true } }); await db.providerChannel.update({ where: { id: a }, data: { enabled: false } }); assert.equal((await chat(m)).status, 200);
  await db.providerChannel.update({ where: { id: a }, data: { enabled: true } });
}
async function startup() {
  for (const address of [...origins, fixtureOrigin]) assert(await fetch(address, { signal: AbortSignal.timeout(300) }).then(() => false).catch(() => true), "Routing fixture ports must be free.");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" });
  fixture.listen(3142, "127.0.0.1"); await once(fixture, "listening");
  for (let index = 0; index < origins.length; index++) {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(3140 + index)], { env: { ...env, APP_ORIGIN: origins[index] }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(child);
    const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-500000); }; child.stdout?.on("data", capture); child.stderr?.on("data", capture);
    await waitFor(() => fetch(origins[index] + "/api/auth/session").then(r => r.status === 200).catch(() => false), 30000);
  }
  const admin = await actor("ADMIN"); adminCookie = admin.cookie; owner = await actor("USER"); regularCookie = owner.cookie;
}
async function main() {
  await startup();
  await check("Admin pages and every channel endpoint enforce server-side roles, including RSC", async () => {
    const m = await model(), id = await channel(m, "a");
    for (const path of ["/api/admin/providers", `/api/admin/providers/${id}/models`, `/api/admin/providers/${id}/attempts`]) {
      await expect(await ui(path, "GET", undefined, ""), 401); await expect(await ui(path, "GET", undefined, regularCookie), 403);
    }
    for (const [path, method] of [["/api/admin/providers", "POST"], [`/api/admin/providers/${id}`, "PATCH"], [`/api/admin/providers/${id}/models`, "POST"]]) await expect(await ui(path, method, {}, regularCookie), 403);
    for (const headers of [{ Cookie: regularCookie }, { Cookie: regularCookie, RSC: "1" }] as Record<string, string>[]) { const response = await fetch(origins[0] + "/admin/providers", { headers, redirect: "manual" }); assert.equal(response.status, 403); await response.text(); }
    const response = await ui("/admin/providers"); assert.equal(response.status, 200); const html = await response.text(); assert(html.includes("Providers") && !html.includes(fixtureKey));
  });
  await check("Channel writes validate environment references, limits, CSRF and forbidden secret fields", async () => {
    const fields = { code: `routing-${seed}-invalid`, name: "Invalid", provider: "DEEPSEEK", apiKeyEnv: "DATABASE_URL", baseUrlEnv: "DEEPSEEK_BASE_URL" };
    await expect(await ui("/api/admin/providers", "POST", fields), 422);
    await expect(await ui("/api/admin/providers", "POST", { ...fields, apiKeyEnv: "DEEPSEEK_API_KEY", apiKey: fixtureKey }), 422);
    await expect(await ui("/api/admin/providers", "POST", { ...fields, apiKeyEnv: "DEEPSEEK_API_KEY", weight: 0 }), 422);
    await expect(await ui("/api/admin/providers", "POST", { ...fields, apiKeyEnv: "DEEPSEEK_API_KEY", concurrency: 1001 }), 422);
    const response = await fetch(origins[0] + "/api/admin/providers", { method: "POST", headers: { Cookie: adminCookie, Origin: "https://foreign.example", "Content-Type": "application/json" }, body: JSON.stringify(fields) });
    await expect(response, 403);
  });
  await check("Normal routing uses the private compatible model and independent exact channel cost", async () => {
    const m = await model(), a = await channel(m, "a"), b = await channel(m, "b");
    const result = await chat(m); assert.equal(result.status, 200); assert.equal(result.body.model, m.slug); assert.equal(result.body.id, `chatcmpl-${result.record.requestId}`);
    assert.equal(result.record.attempts.length, 1); assert.equal(result.record.attempts[0].channelId, a); assert.notEqual(a, b);
    assert.equal(calls.at(-1)!.model, m.providerModel); assert.equal(result.record.providerCost?.toFixed(20), "0.00000260000000000000"); assert.equal(result.record.userCost?.toFixed(20), "0.00012000000000000000");
    assert.equal(result.record.providerCostStatus, "KNOWN"); assert.equal(await db.walletTransaction.count({ where: { requestId: result.record.requestId } }), 1);
  });
  await check("Partial channel edits preserve unrelated limits and idempotency configuration", async () => {
    const m = await model(), id = await channel(m, "a", { priority: 7, rpm: 123, timeoutMs: 700, concurrency: 23, idempotentRequests: true });
    await expect(await ui(`/api/admin/providers/${id}`, "PATCH", { weight: 9 }), 200);
    const saved = await db.providerChannel.findUniqueOrThrow({ where: { id } });
    assert.equal(saved.weight, 9); assert.equal(saved.priority, 7); assert.equal(saved.rpm, 123); assert.equal(saved.timeoutMs, 700);
    assert.equal(saved.concurrency, 23); assert.equal(saved.idempotentRequests, true);
  });
  await check("Incompatible provider IDs, providers and insufficient context cannot become fallback routes", async () => {
    const m = await model(), id = await channel(m, "a");
    for (const fields of [{ providerModel: "different-capability" }, { contextWindow: 1 }]) await expect(await ui(`/api/admin/providers/${id}/models`, "POST", {
      modelSlug: m.slug, providerModel: m.providerModel, contextWindow: m.contextWindow, inputPricePerMillion: "1", outputPricePerMillion: "1", enabled: true, preferred: false, ...fields }), 422);
    const us = await db.providerChannel.create({ data: { code: `routing-${seed}-incompatible`, name: "Unconfigured fixture", provider: "OPENAI", apiKeyEnv: "OPENAI_API_KEY", baseUrlEnv: "OPENAI_BASE_URL" } }); channelIds.push(us.id);
    await expect(await ui(`/api/admin/providers/${us.id}/models`, "POST", { modelSlug: m.slug, providerModel: m.providerModel, contextWindow: m.contextWindow, inputPricePerMillion: "1", outputPricePerMillion: "1", enabled: true, preferred: false }), 422);
    const before = calls.length; await db.model.update({ where: { id: m.id }, data: { providerModel: "changed-capability" } });
    await noCharge(m, 503, "provider_unavailable"); assert.equal(calls.length, before);
  });
  await check("Admin can prefer a healthy compatible channel and return to automatic priority", async () => {
    const m = await model(), a = await channel(m, "a"), b = await channel(m, "b"); await warm(m, a, b);
    await bind(b, m, { preferred: true }); assert.equal((await chat(m)).record.attempts[0].channelId, b);
    await bind(b, m, { preferred: false }); assert.equal((await chat(m)).record.attempts[0].channelId, a);
    await expect(await ui(`/api/admin/providers/${a}`, "PATCH", { enabled: false }), 200); assert.equal((await chat(m)).record.attempts[0].channelId, b);
    await expect(await ui(`/api/admin/providers/${b}`, "PATCH", { enabled: false }), 200); const before = calls.length;
    await noCharge(m, 503, "provider_unavailable"); assert.equal(calls.length, before);
  });
  await check("Healthy channels outrank a degraded preferred channel", async () => {
    const m = await model(), a = await channel(m, "a"), b = await channel(m, "b"); mode(m, "a", "fail"); await noCharge(m, 502, "provider_unavailable");
    mode(m, "a", "success"); await db.providerChannel.update({ where: { id: a }, data: { enabled: false } }); assert.equal((await chat(m)).status, 200); await db.providerChannel.update({ where: { id: a }, data: { enabled: true } });
    await bind(a, m, { preferred: true }); assert.equal((await chat(m)).record.attempts[0].channelId, b);
  });
  await check("Routing compares latency and cost before weighting equally ranked channels", async () => {
    const m = await model(), a = await channel(m, "a", { priority: 10 }), b = await channel(m, "b", { priority: 10 }); await warm(m, a, b);
    await db.providerAttempt.updateMany({ where: { channelId: a }, data: { latencyMs: 1400 } }); await db.providerAttempt.updateMany({ where: { channelId: b }, data: { latencyMs: 20 } });
    assert.equal((await chat(m)).record.attempts[0].channelId, b);
    await db.providerAttempt.updateMany({ where: { channelId: a }, data: { latencyMs: 20 } });
    await bind(b, m, { inputPricePerMillion: "0.01", outputPricePerMillion: "0.02" }); assert.equal((await chat(m)).record.attempts[0].channelId, b);
    await bind(b, m); await expect(await ui(`/api/admin/providers/${b}`, "PATCH", { weight: 3 }), 200);
    const counts = new Map([[a, 0], [b, 0]]);
    for (let i = 0; i < 60; i++) { const result = await chat(m); assert.equal(result.status, 200); const id = result.record.attempts[0].channelId; counts.set(id, counts.get(id)! + 1); }
    assert(counts.get(a)! > 0 && counts.get(b)! > 0);
  });
  await check("A proven pre-execution 429 fails over with one root request and one wallet charge", async () => {
    const m = await model(), a = await channel(m, "a"), b = await channel(m, "b", {}, { input: "0.4", output: "0.6" }); mode(m, "a", "rate");
    const result = await chat(m); assert.equal(result.status, 200); assert.equal(result.record.attempts.length, 2);
    assert.equal(result.record.attempts[0].channelId, a); assert.equal(result.record.attempts[0].executionState, "REJECTED"); assert.equal(result.record.attempts[0].costStatus, "NOT_INCURRED"); assert(result.record.attempts[0].providerCost?.isZero());
    assert.equal(result.record.attempts[1].channelId, b); assert(result.record.attempts.every(a => a.requestId === result.record.requestId));
    assert.equal(result.record.providerCost?.toFixed(20), "0.00000900000000000000"); assert.equal(result.record.userCost?.toFixed(20), "0.00012000000000000000");
    assert.equal(await db.walletTransaction.count({ where: { requestId: result.record.requestId } }), 1); assert((await wallet()).reservedBalance.isZero());
  });
  await check("An ambiguous 429 is not blindly replayed and its cost remains pending reconciliation", async () => {
    const m = await model(); await channel(m, "a"); await channel(m, "b"); mode(m, "a", "ambiguous-rate");
    const result = await noCharge(m, 429, "provider_rate_limit"); assert.equal(result.record.attempts.length, 1);
    assert.equal(result.record.providerCost, null); assert.equal(result.record.providerCostStatus, "PENDING_RECONCILIATION"); assert.equal(result.record.attempts[0].executionState, "UNCERTAIN");
  });
  await check("Unknown 500, timeout and partial body failures release holds without duplicate execution", async () => {
    for (const value of ["fail", "timeout", "partial"] as const) {
      const m = await model(); await channel(m, "a", { timeoutMs: 150 }); await channel(m, "b"); mode(m, "a", value);
      const before = calls.length, result = await noCharge(m, value === "fail" ? 502 : 504, value === "fail" ? "provider_unavailable" : "provider_timeout");
      assert.equal(calls.length - before, 1); assert.equal(result.record.attempts.length, 1); assert.equal(result.record.providerCost, null); assert.equal(result.record.attempts[0].costStatus, "PENDING_RECONCILIATION");
    }
  });
  await check("Known usage on a provider 500 is logged as a real cost without charging the user or retrying", async () => {
    const m = await model(); await channel(m, "a", { idempotentRequests: true }); await channel(m, "b"); mode(m, "a", "fail-known");
    const result = await noCharge(m, 502, "provider_unavailable"); assert.equal(result.record.attempts.length, 1); assert.equal(result.record.providerCost?.toFixed(20), "0.00000260000000000000");
    assert.equal(result.record.totalTokens, 19); assert.equal(result.record.providerCostStatus, "KNOWN");
  });
  await check("Verified idempotent timeout retry stays on the same channel and deduplicates upstream cost", async () => {
    const m = await model(), a = await channel(m, "a", { timeoutMs: 150, idempotentRequests: true }); await channel(m, "b"); mode(m, "a", "idempotent");
    const before = executions.size, result = await chat(m); assert.equal(result.status, 200); assert.equal(executions.size - before, 1);
    assert.equal(result.record.attempts.length, 2); assert(result.record.attempts.every(t => t.channelId === a && t.costStatus === "KNOWN"));
    assert.equal(result.record.attempts[0].status, "FAILED"); assert.equal(result.record.attempts[0].executionGroup, result.record.attempts[1].executionGroup);
    const recent = calls.filter(c => c.model === m.providerModel); assert.equal(recent.length, 2); assert(recent.every(c => c.path === "a" && c.idempotencyKey === result.record.requestId));
    assert.equal(result.record.providerCost?.toFixed(20), "0.00000260000000000000"); assert.equal(await db.walletTransaction.count({ where: { requestId: result.record.requestId } }), 1);
    const stats = await expect(await ui(`/api/admin/providers?search=${(await db.providerChannel.findUniqueOrThrow({ where: { id: a } })).code}`), 200) as ProviderPageData;
    assert.equal(stats.channels[0].windows["5m"].cost, "0.00000260000000000000"); assert.equal(stats.channels[0].windows["5m"].unknownCosts, "0");
  });
  await check("A rejected idempotent replay never forgets an earlier uncertain execution or switches channels", async () => {
    const m = await model(), a = await channel(m, "a", { timeoutMs: 150, idempotentRequests: true }); await channel(m, "b"); mode(m, "a", "idempotent-rate");
    const before = executions.size, result = await noCharge(m, 429, "provider_rate_limit");
    assert.equal(executions.size - before, 1); assert.equal(result.record.status, "FAILED");
    assert.equal(result.record.attempts.length, 2); assert(result.record.attempts.every(t => t.channelId === a));
    assert.equal(result.record.attempts[0].executionState, "UNCERTAIN"); assert.equal(result.record.attempts[1].executionState, "REJECTED");
    assert.equal(result.record.providerCost, null); assert.equal(result.record.providerCostStatus, "PENDING_RECONCILIATION");
    const recent = calls.filter(c => c.model === m.providerModel); assert.equal(recent.length, 2);
    assert(recent.every(c => c.path === "a" && c.idempotencyKey === result.record.requestId));
  });
  await check("Rejected zero-token replays cannot confirm earlier uncertain costs, including expired leases", async () => {
    const m = await model(), a = await channel(m, "a", { timeoutMs: 150, idempotentRequests: true }); await channel(m, "b"); mode(m, "a", "idempotent-rate-zero");
    const result = await noCharge(m, 429, "provider_rate_limit"); assert.equal(result.record.attempts.length, 2);
    assert(result.record.attempts.every(t => t.channelId === a)); assert.equal(result.record.attempts[0].costStatus, "PENDING_RECONCILIATION");
    assert.equal(result.record.attempts[1].costStatus, "KNOWN"); assert(result.record.attempts[1].providerCost?.isZero());
    assert.equal(result.record.providerCost, null); assert.equal(result.record.providerCostStatus, "PENDING_RECONCILIATION");

    const expired = await model(), id = await channel(expired, "a", { idempotentRequests: true, failureThreshold: 2 }), requestId = randomUUID();
    const binding = await db.modelChannel.findFirstOrThrow({ where: { channelId: id }, include: { channel: true } });
    await reserveRequest(requestId, { userId: owner.id, apiKeyId: owner.keyId }, expired, { model: expired.slug, messages: [{ role: "user", content: "Synthetic" }], max_tokens: 16 });
    const first = await claimAttempt(binding, requestId, 1, 150, Date.now() + 10000); assert(first); await markDispatched(first.attempt.id);
    await finishAttempt(first, 50, { error: new GatewayError(504, "Safe", "server_error", "provider_timeout", undefined, undefined, { execution: "UNCERTAIN" }) });
    const replay = await claimAttempt(binding, requestId, 2, 150, Date.now() + 10000); assert(replay); await markDispatched(replay.attempt.id);
    await db.providerAttempt.update({ where: { id: replay.attempt.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal(await claimAttempt(binding, requestId, 3, 150, Date.now() + 10000), undefined);
    await settleFailure(owner.id, requestId, "provider_attempt_expired", 100);
    await finishAttempt(replay, 100, { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      error: new GatewayError(429, "Safe", "rate_limit_error", "provider_rate_limit", 1, undefined, { execution: "REJECTED" }) });
    const late = await db.apiRequest.findUniqueOrThrow({ where: { requestId }, include: { attempts: { orderBy: { attemptNumber: "asc" } } } });
    assert.equal(late.status, "FAILED"); assert.equal(late.providerCost, null); assert.equal(late.providerCostStatus, "PENDING_RECONCILIATION");
    assert.equal(late.attempts[0].costStatus, "PENDING_RECONCILIATION"); assert.equal(late.attempts[1].costStatus, "KNOWN");
    assert.equal(await db.walletTransaction.count({ where: { requestId } }), 0); assert((await wallet()).reservedBalance.isZero());
  });
  await check("Retry budget permits at most three attempts and never crosses uncertain idempotent channels", async () => {
    const m = await model(); await channel(m, "a"); await channel(m, "b"); await channel(m, "c");
    for (const path of ["a", "b", "c"]) mode(m, path, "rate");
    const result = await noCharge(m, 429, "provider_rate_limit"); assert.equal(result.record.attempts.length, 3); assert(result.record.providerCost?.isZero()); assert.equal(result.record.providerCostStatus, "NOT_INCURRED");
    const uncertain = await model(), id = await channel(uncertain, "a", { idempotentRequests: true }); await channel(uncertain, "b"); mode(uncertain, "a", "fail");
    const failed = await noCharge(uncertain, 502, "provider_unavailable"); assert.equal(failed.record.attempts.length, 3); assert(failed.record.attempts.every(t => t.channelId === id)); assert.equal(failed.record.providerCost, null);
  });
  await check("Changing a channel destination during an uncertain execution forbids replay", async () => {
    const m = await model(), id = await channel(m, "a", { idempotentRequests: true, timeoutMs: 300 }); mode(m, "a", "timeout");
    const count = calls.length, pending = chat(m); await waitFor(() => calls.length > count);
    await expect(await ui(`/api/admin/providers/${id}`, "PATCH", { baseUrlEnv: "DEEPSEEK_HAB_BASE_URL" }), 200);
    const result = await pending; assert.equal(result.status, 504); assert.equal(result.record.attempts.length, 1); assert.equal(calls.length - count, 1);
    assert.equal(result.record.providerCost, null); assert((await wallet()).reservedBalance.isZero());
  });
  await check("Client errors and any already-started streamed output forbid replay", async () => {
    const m = await model(); await channel(m, "a", { idempotentRequests: true }); await channel(m, "b"); mode(m, "a", "invalid");
    assert.equal((await noCharge(m, 400, "invalid_request")).record.attempts.length, 1);
    for (const execution of ["REJECTED", "UNCERTAIN"] as const) {
      const error = new GatewayError(502, "Safe", "server_error", "provider_unavailable", undefined, undefined, { execution, outputStarted: true });
      assert.equal(retryDecision(error, true, 1, 3), "STOP");
    }
    const before = calls.length, balance = await wallet(), result = await chat(m, 0, { stream: "true" });
    assert.equal(result.status, 400); assert.equal(result.body.error.code, "invalid_request"); assert.equal(result.record.attempts.length, 0); assert.equal(calls.length, before); assert.equal((await wallet()).balance.toFixed(20), balance.balance.toFixed(20));
  });
  await check("Circuit trips, routes around the fault, admits one distributed probe and recovers", async () => {
    const m = await model(), a = await channel(m, "a", { failureThreshold: 2, cooldownMs: 500, timeoutMs: 10000, priority: 500 }), b = await channel(m, "b", { enabled: false }); mode(m, "a", "fail");
    await noCharge(m, 502, "provider_unavailable"); await noCharge(m, 502, "provider_unavailable");
    assert.equal((await db.providerChannel.findUniqueOrThrow({ where: { id: a } })).circuitState, "OPEN");
    const before = calls.length, rejected = await noCharge(m, 503, "provider_unavailable"); assert.equal(calls.length, before); assert(rejected.record.providerCost?.isZero());
    await db.providerChannel.update({ where: { id: b }, data: { enabled: true } }); assert.equal((await chat(m)).record.attempts[0].channelId, b);
    await db.providerAttempt.updateMany({ where: { channelId: a }, data: { latencyMs: 5000 } });
    await db.providerChannel.update({ where: { id: a }, data: { openedUntil: new Date(Date.now() - 1) } }); mode(m, "a", "hold");
    const count = calls.filter(c => c.model === m.providerModel && c.path === "a").length;
    const pending = Array.from({ length: 10 }, (_, i) => chat(m, i % 2)); await waitFor(() => calls.filter(c => c.model === m.providerModel && c.path === "a").length > count);
    await waitFor(async () => await db.apiRequest.count({ where: { modelId: m.id, status: "SUCCESS" } }) >= 10);
    assert.equal(calls.filter(c => c.model === m.providerModel && c.path === "a").length - count, 1);
    replies.splice(0).forEach(reply => reply()); const results = await Promise.all(pending); assert(results.every(r => r.status === 200));
    assert.equal((await db.providerChannel.findUniqueOrThrow({ where: { id: a } })).circuitState, "CLOSED");
    mode(m, "a", "success"); assert((await wallet()).reservedBalance.isZero());
  });
  await check("Late successes cannot close a newer open circuit generation", async () => {
    const m = await model(), id = await channel(m, "a", { failureThreshold: 1 });
    const binding = await db.modelChannel.findFirstOrThrow({ where: { channelId: id }, include: { channel: true } });
    const input = { model: m.slug, messages: [{ role: "user" as const, content: "Synthetic" }], max_tokens: 16 };
    const first = randomUUID(), second = randomUUID();
    for (const requestId of [first, second]) await reserveRequest(requestId, { userId: owner.id, apiKeyId: owner.keyId }, m, input);
    const c1 = await claimAttempt(binding, first, 1, 150, Date.now() + 10000), c2 = await claimAttempt(binding, second, 1, 150, Date.now() + 10000); assert(c1 && c2);
    await markDispatched(c1.attempt.id); await markDispatched(c2.attempt.id);
    await finishAttempt(c1, 20, { error: new GatewayError(504, "Safe", "server_error", "provider_timeout", undefined, undefined, { execution: "UNCERTAIN" }) });
    await finishAttempt(c2, 30, { usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 } });
    assert.equal((await db.providerChannel.findUniqueOrThrow({ where: { id } })).circuitState, "OPEN");
    await settleFailure(owner.id, first, "provider_timeout", 20); await settleSuccess(owner.id, second, { inputTokens: 12, outputTokens: 7, totalTokens: 19 }, 30);
  });
  await check("Expired probe leases recover conservatively and permit a later single probe", async () => {
    const m = await model(), id = await channel(m, "a", { failureThreshold: 1, cooldownMs: 100 });
    const backup = await channel(m, "b"); await warm(m, id, backup);
    const binding = await db.modelChannel.findFirstOrThrow({ where: { channelId: id }, include: { channel: true } }), requestId = randomUUID();
    await reserveRequest(requestId, { userId: owner.id, apiKeyId: owner.keyId }, m, { model: m.slug, messages: [{ role: "user", content: "Synthetic" }], max_tokens: 16 });
    await db.providerChannel.update({ where: { id }, data: { circuitState: "OPEN", openedUntil: new Date(Date.now() - 1) } });
    const claim = await claimAttempt(binding, requestId, 1, 150, Date.now() + 10000); assert(claim); await markDispatched(claim.attempt.id);
    await db.providerAttempt.update({ where: { id: claim.attempt.id }, data: { expiresAt: new Date(Date.now() - 1) } }); await db.providerChannel.update({ where: { id }, data: { probeExpiresAt: new Date(Date.now() - 1) } });
    // A healthy backup must not starve lease cleanup of a crashed HALF_OPEN probe.
    const cleanup = await chat(m); assert.equal(cleanup.status, 200); assert.equal(cleanup.record.attempts[0].channelId, backup);
    assert.equal((await db.providerChannel.findUniqueOrThrow({ where: { id } })).circuitState, "OPEN");
    const attempt = await db.providerAttempt.findUniqueOrThrow({ where: { id: claim.attempt.id } }); assert.equal(attempt.status, "FAILED"); assert.equal(attempt.costStatus, "PENDING_RECONCILIATION"); assert.equal(attempt.providerCost, null);
    await settleFailure(owner.id, requestId, "provider_attempt_expired", 100);
    await db.providerChannel.update({ where: { id }, data: { openedUntil: new Date(Date.now() - 1) } }); const result = await chat(m); assert.equal(result.status, 200);
    assert.equal(result.record.attempts[0].channelId, id);
    assert.equal((await db.providerChannel.findUniqueOrThrow({ where: { id } })).circuitState, "CLOSED");
  });
  await check("Channel RPM and TPM admission is atomic and rejected requests release their balances", async () => {
    const m = await model(); await channel(m, "a", { rpm: 2 }); const results = await Promise.all(Array.from({ length: 10 }, (_, i) => chat(m, i % 2)));
    assert.equal(results.filter(r => r.status === 200).length, 2); assert.equal(results.filter(r => r.status === 429).length, 8);
    for (const r of results.filter(r => r.status === 429)) { assert.equal(r.record.attempts.length, 0); assert(r.record.userCost?.isZero()); assert(r.record.providerCost?.isZero()); }
    const tokens = await model(); await channel(tokens, "a", { tpm: 1 }); const before = calls.length;
    await noCharge(tokens, 429, "provider_rate_limit"); assert.equal(calls.length, before); assert((await wallet()).reservedBalance.isZero());
  });
  await check("Late confirmed usage reconciles an expired attempt without reviving or debiting its failed request", async () => {
    const m = await model(), id = await channel(m, "a", { failureThreshold: 1 }), requestId = randomUUID();
    const binding = await db.modelChannel.findFirstOrThrow({ where: { channelId: id }, include: { channel: true } });
    const input = { model: m.slug, messages: [{ role: "user" as const, content: "Synthetic" }], max_tokens: 16 };
    await reserveRequest(requestId, { userId: owner.id, apiKeyId: owner.keyId }, m, input);
    const claim = await claimAttempt(binding, requestId, 1, 150, Date.now() + 10000); assert(claim); await markDispatched(claim.attempt.id);
    await db.providerAttempt.update({ where: { id: claim.attempt.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal(await claimAttempt(binding, requestId, 2, 150, Date.now() + 10000), undefined);
    await settleFailure(owner.id, requestId, "provider_attempt_expired", 50);
    const before = await wallet(), usage = { inputTokens: 12, outputTokens: 7, totalTokens: 19 };
    await finishAttempt(claim, 100, { usage }); await finishAttempt(claim, 100, { usage }); await settleSuccess(owner.id, requestId, usage, 100);
    const request = await db.apiRequest.findUniqueOrThrow({ where: { requestId }, include: { attempts: true } });
    assert.equal(request.status, "FAILED"); assert.equal(request.errorCode, "provider_attempt_expired"); assert.equal(request.providerCostStatus, "KNOWN");
    assert.equal(request.providerCost?.toFixed(20), "0.00000260000000000000"); assert.equal(request.attempts[0].status, "FAILED"); assert.equal(request.attempts[0].costStatus, "KNOWN");
    assert.equal((await wallet()).balance.toFixed(20), before.balance.toFixed(20)); assert.equal(await db.walletTransaction.count({ where: { requestId } }), 0);
    assert.equal((await db.providerChannel.findUniqueOrThrow({ where: { id } })).circuitState, "OPEN");
  });
  await check("100 concurrent requests across two servers admit only 10 upstream executions", async () => {
    const m = await model(); await channel(m, "a", { concurrency: 10, timeoutMs: 20000 }); mode(m, "a", "hold");
    const count = calls.length, batch = Array.from({ length: 100 }, (_, i) => chat(m, i % 2));
    await waitFor(() => calls.length - count === 10, 30000);
    await waitFor(async () => await db.apiRequest.count({ where: { modelId: m.id, status: "FAILED" } }) === 90, 30000);
    assert.equal(calls.length - count, 10); replies.splice(0).forEach(reply => reply());
    const results = await Promise.all(batch); assert.equal(results.filter(r => r.status === 200).length, 10); assert.equal(results.filter(r => r.status === 429).length, 90);
    assert.equal(await db.walletTransaction.count({ where: { requestId: { in: results.map(r => r.record.requestId) } } }), 10);
    const balance = await wallet(); assert(!balance.balance.isNegative()); assert(balance.reservedBalance.isZero());
  });
  await check("Repeated success and failure settlement cannot duplicate charges or rewrite attempt snapshots", async () => {
    const m = await model(); await channel(m, "a"); const result = await chat(m), before = await wallet();
    await Promise.all(Array.from({ length: 10 }, () => settleSuccess(owner.id, result.record.requestId, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 1)));
    await settleFailure(owner.id, result.record.requestId, "different", 1);
    assert.equal((await wallet()).balance.toFixed(20), before.balance.toFixed(20)); assert.equal(await db.walletTransaction.count({ where: { requestId: result.record.requestId } }), 1);
    await assert.rejects(db.providerAttempt.update({ where: { id: result.record.attempts[0].id }, data: { inputPricePerMillion: "5" } }));
    await assert.rejects(db.providerAttempt.update({ where: { id: result.record.attempts[0].id }, data: { providerCost: "0", costStatus: "NOT_INCURRED" } }));
  });
  await check("Sales price snapshots survive channel edits and one-token provider costs stay exact", async () => {
    const m = await model(), id = await channel(m, "a"); mode(m, "a", "hold");
    const count = calls.length, pending = chat(m); await waitFor(() => calls.length > count);
    await expect(await ui(`/api/admin/providers/${id}/models`, "POST", { modelSlug: m.slug, providerModel: m.providerModel, contextWindow: m.contextWindow, inputPricePerMillion: "999", outputPricePerMillion: "999", enabled: true, preferred: false }), 200);
    await db.model.update({ where: { id: m.id }, data: { markupMultiplier: "9" } }); replies.splice(0).forEach(reply => reply());
    const result = await pending; assert.equal(result.status, 200); assert.equal(result.record.providerCost?.toFixed(20), "0.00000260000000000000"); assert.equal(result.record.userCost?.toFixed(20), "0.00012000000000000000");
    const minimal = await model(); await channel(minimal, "a", {}, { input: "0.00000001", output: "0.00000001" }); mode(minimal, "a", "success", { input: 1, output: 0 });
    assert.equal((await chat(minimal)).record.providerCost?.toFixed(20), "0.00000000000001000000");
  });
  await check("Health statistics distinguish 5 minutes, 1 hour and 24 hours and exclude unknown costs", async () => {
    const m = await model(), id = await channel(m, "a"); const samples = [];
    for (let i = 0; i < 3; i++) samples.push(await chat(m));
    const now = Date.now();
    for (let i = 0; i < samples.length; i++) await db.providerAttempt.update({ where: { id: samples[i].record.attempts[0].id }, data: { createdAt: new Date(now - [60000, 1200000, 7200000][i]) } });
    mode(m, "a", "fail"); await noCharge(m, 502, "provider_unavailable");
    const code = (await db.providerChannel.findUniqueOrThrow({ where: { id } })).code;
    const data = await expect(await ui(`/api/admin/providers?search=${code}&window=24h`), 200) as ProviderPageData, health = data.channels[0];
    assert.equal(health.windows["5m"].requests, "2"); assert.equal(health.windows["1h"].requests, "3"); assert.equal(health.windows["24h"].requests, "4");
    assert.equal(health.windows["5m"].cost, "0.00000260000000000000"); assert.equal(health.windows["1h"].cost, "0.00000520000000000000"); assert.equal(health.windows["24h"].cost, "0.00000780000000000000");
    assert.equal(health.windows["24h"].unknownCosts, "1"); assert.equal(health.windows["5m"].successRate, 0.5); assert.equal(health.windows["5m"].errorRate, 0.5);
    const attempts = await expect(await ui(`/api/admin/providers/${id}/attempts?pageSize=10`), 200); assert.equal(attempts.pagination.total, 4); assert(attempts.attempts.some((a: { providerCost: unknown }) => a.providerCost === null));
  });
  await check("Provider listings and attempt history use server pagination and strict filters", async () => {
    const first = await expect(await ui(`/api/admin/providers?search=routing-${seed}&pageSize=10`), 200) as ProviderPageData;
    assert.equal(first.channels.length, 10); assert(first.pagination.total > 10);
    const second = await expect(await ui(`/api/admin/providers?search=routing-${seed}&pageSize=10&page=2`), 200) as ProviderPageData;
    assert(!second.channels.some(c => first.channels.some(a => a.id === c.id)));
    await expect(await ui("/api/admin/providers?window=invalid"), 400); await expect(await ui("/api/admin/providers?userId=" + owner.id), 400);
    await expect(await ui("/api/admin/providers?page=1&page=2"), 400);
    const id = channelIds[0]; await expect(await ui(`/api/admin/providers/${id}/attempts?pageSize=50000`), 400);
  });
  await check("Existing models bootstrap a default tracked channel but never bypass disabled bindings", async () => {
    const m = await model(), result = await chat(m); assert.equal(result.status, 200); assert.equal(result.record.attempts.length, 1); assert.equal(calls.at(-1)!.path, "legacy");
    const binding = await db.modelChannel.findFirstOrThrow({ where: { modelId: m.id } }); await db.modelChannel.update({ where: { id: binding.id }, data: { enabled: false } });
    const count = calls.length; await noCharge(m, 503, "provider_unavailable"); assert.equal(calls.length, count);
  });
  await check("Every root request and attempt reconciles without negative wallets, duplicate ledgers or sensitive logs", async () => {
    const balance = await wallet(), entries = await db.walletTransaction.findMany({ where: { walletId: balance.id } });
    const total = entries.reduce((sum, e) => sum.plus(money(e.amount)), money("0"));
    assert.equal(balance.balance.toFixed(20), money("10").plus(total).toFixed(20)); assert(!balance.balance.isNegative()); assert(balance.reservedBalance.isZero());
    assert.equal(await db.apiRequest.count({ where: { userId: owner.id, status: "PENDING" } }), 0);
    const records = await db.apiRequest.findMany({ where: { userId: owner.id }, include: { attempts: true } });
    assert.equal(records.filter(r => r.status === "SUCCESS").length, entries.length);
    const stored = JSON.stringify(records);
    for (const forbidden of [fixtureKey, prompt, owner.key, "Local fixture response"]) assert(!stored.includes(forbidden) && !output.includes(forbidden));
    const columns = await db.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'ProviderAttempt'`;
    assert(!columns.some(c => /prompt|response|apiKey|secret/i.test(c.column_name)));
  });
  console.log(`High-availability routing: ${passed} checks passed (two servers, local simulated channels; no live provider spending).`);
}
async function run() {
  try { await main(); }
  catch (error) {
    console.error(`FAIL ${activeCheck}. Secrets and raw upstream output were withheld.`);
    if (error instanceof assert.AssertionError) console.error(`Assertion at ${error.stack?.split("\n").find(line => line.includes("test-routing.ts"))?.trim() ?? "integration check"}`);
    process.exitCode = 1;
  } finally {
    replies.splice(0).forEach(reply => reply()); for (const timer of timers) clearTimeout(timer);
    for (const child of children) if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]); }
    fixture.closeAllConnections(); if (fixture.listening) await new Promise<void>(resolve => fixture.close(() => resolve()));
    await db.user.deleteMany({ where: { id: { in: users }, email: { startsWith: `routing-${seed}-` } } });
    await db.model.deleteMany({ where: { id: { in: models.map(m => m.id) }, slug: { startsWith: `routing-${seed}-` } } });
    await db.providerChannel.deleteMany({ where: { id: { in: channelIds }, code: { startsWith: `routing-${seed}-` } } });
    await risk.cleanup(); await db.$disconnect(); await getDb().$disconnect();
  }
}
void run().catch(() => { console.error("Routing cleanup failed; sensitive diagnostics were withheld."); process.exitCode = 1; });
