import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Model, type ModelProvider } from "../generated/prisma/client";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { hashPassword } from "../lib/server/password";
import { getDb } from "../lib/server/db";
import { money } from "../lib/billing/money";
import { settleFailure, settleSuccess } from "../lib/billing/wallet";
import { admitRisk, finishRisk } from "../lib/risk/limiter";
import { closeRiskRedis } from "../lib/risk/redis";
import { buildRequestExamples, docsSections } from "../lib/docs-content";
import { playgroundParameters } from "../lib/playground-parameters";
import { readPlaygroundStream, PlaygroundError } from "../lib/playground-stream";
import type { PlaygroundStats } from "../lib/playground-types";
import { riskTestEnvironment } from "./risk-test-environment";

config({ quiet: true });
const databaseUrl = process.env.DATABASE_URL_TEST;
assert(databaseUrl && databaseUrl !== process.env.DATABASE_URL && new URL(databaseUrl).pathname === "/aihub_auth_test" && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname));
const ui = process.argv.includes("--ui");
const risk = riskTestEnvironment("playground"), origins = [3160, 3161].map(port => `http://${ui ? "localhost" : "127.0.0.1"}:${port}`), upstream = "http://127.0.0.1:3162";
const env: NodeJS.ProcessEnv = { ...process.env, ...risk.env, DATABASE_URL: databaseUrl, NODE_ENV: "production", PAYMENTS_ENABLED: "false", UPSTREAM_API_KEY: "",
  GATEWAY_USER_RPM: "60", GATEWAY_API_KEY_RPM: "60", GATEWAY_USER_TPM: "200000", GATEWAY_API_KEY_TPM: "200000", GATEWAY_API_KEY_CONCURRENCY: "10" };
const providers = ["OPENAI", "ANTHROPIC", "GOOGLE", "DEEPSEEK"] as const;
const secrets = Object.fromEntries(providers.map(provider => [provider, `fixture-${randomBytes(32).toString("hex")}`])) as Record<ModelProvider, string>;
for (const provider of providers) { const prefix = provider === "GOOGLE" ? "GEMINI" : provider; env[`${prefix}_API_KEY`] = secrets[provider]; env[`${prefix}_BASE_URL`] = `${upstream}/${provider.toLowerCase()}/v1`; }
Object.assign(process.env, env);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 6 }), log: [] });
const seed = randomBytes(6).toString("hex"), children: ChildProcess[] = [], models: Model[] = [], owners: Owner[] = [];
type Owner = { id: string; cookie: string; key: string; email: string };
type Mode = "success" | "hold" | "missing" | "timeout" | "slow" | "headers";
const modes = new Map<string, Mode>(), calls: string[] = [], releases: (() => void)[] = [], closed = new Set<string>();
const content = "Hello, AIHub.\n\n```javascript\nconst answer = 42;\n```\n\n**Ready to build.**";
let output = "", passed = 0, activeCheck = "startup";
const python = process.env.PYTHON_TEST_EXECUTABLE ?? (process.platform === "win32" ? "python" : "python3");
const pythonPath = resolve(process.env.PYTHON_TEST_PATH ?? "../../work/python-sdk"), uiFile = resolve("../../work/playground-ui-fixture.json");
const uiPassword = "Isolated-Playground-Fixture-26!";

function nativeUsage(provider: ModelProvider) {
  if (provider === "ANTHROPIC") return { input_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 5, output_tokens: 7 };
  if (provider === "GOOGLE") return { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 3, totalTokenCount: 19 };
  return { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 };
}
function normal(provider: ModelProvider) {
  if (provider === "ANTHROPIC") return { role: "assistant", content: [{ type: "text", text: content }], stop_reason: "end_turn", usage: nativeUsage(provider) };
  if (provider === "GOOGLE") return { candidates: [{ index: 0, content: { role: "model", parts: [{ text: content }] }, finishReason: "STOP" }], usageMetadata: nativeUsage(provider) };
  return { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: nativeUsage(provider) };
}
function frames(provider: ModelProvider, missing = false) {
  const pieces = ["Hello, AIHub.", "\n\n```javascript\nconst answer = 42;\n```", "\n\n**Ready to build.**"];
  if (provider === "ANTHROPIC") return [
    { type: "message_start", message: { role: "assistant", usage: nativeUsage(provider) } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...pieces.map(text => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: missing ? {} : nativeUsage(provider) }, { type: "message_stop" },
  ];
  if (provider === "GOOGLE") return [...pieces.map(text => ({ candidates: [{ index: 0, content: { parts: [{ text }] } }] })),
    { candidates: [{ index: 0, content: { parts: [] }, finishReason: "STOP" }], ...(missing ? {} : { usageMetadata: nativeUsage(provider) }) }];
  return [
    ...pieces.map(text => ({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })),
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], ...(provider === "DEEPSEEK" && !missing ? { usage: nativeUsage(provider) } : {}) },
    ...(provider === "OPENAI" && !missing ? [{ choices: [], usage: nativeUsage(provider) }] : []), "[DONE]",
  ];
}
const fixture = createServer(async (request, response) => {
  try {
    const path = request.url ?? "", provider = providers.find(value => path.includes(`/${value.toLowerCase()}/`)) ?? "DEEPSEEK";
    const header = provider === "ANTHROPIC" ? "x-api-key" : provider === "GOOGLE" ? "x-goog-api-key" : "authorization";
    assert.equal(request.headers[header], provider === "ANTHROPIC" || provider === "GOOGLE" ? secrets[provider] : `Bearer ${secrets[provider]}`);
    assert.equal(request.headers.cookie, undefined);
    const buffers: Buffer[] = []; for await (const chunk of request) buffers.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    const identifier: string = provider === "GOOGLE" ? decodeURIComponent(path.split("/models/")[1].split(":")[0]) : body.model;
    assert(!JSON.stringify(body).includes("submissionId"));
    const mode = modes.get(identifier) ?? "success", streaming = provider === "GOOGLE" ? path.includes(":streamGenerateContent") : body.stream;
    calls.push(identifier); response.on("close", () => closed.add(identifier));
    if (mode === "headers") return;
    if (!streaming) { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(normal(provider))); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const events = frames(provider, mode === "missing");
    const write = (value: unknown) => {
      const data = Buffer.from(`${provider === "ANTHROPIC" && typeof value === "object" ? `event: ${(value as { type: string }).type}\r\n` : ""}data: ${typeof value === "string" ? value : JSON.stringify(value)}\r\n\r\n`);
      for (let offset = 0; offset < data.length; offset += 7) response.write(data.subarray(offset, offset + 7));
    };
    const initial = provider === "ANTHROPIC" ? 3 : 1;
    events.slice(0, initial).forEach(write);
    const complete = async () => {
      for (const event of events.slice(initial)) { if (response.destroyed) return; if (mode === "slow") await new Promise(resolve => setTimeout(resolve, 350)); write(event); }
      response.end();
    };
    if (mode === "hold") { releases.push(() => { void complete(); }); return; }
    if (mode === "timeout") return;
    await complete();
  } catch { if (!response.destroyed) response.destroy(); }
});
async function waitFor(check: () => Promise<boolean> | boolean, ms = 20000) { const end = Date.now() + ms; while (!await check()) { assert(Date.now() < end, "Fixture wait exceeded its deadline."); await new Promise(resolve => setTimeout(resolve, 20)); } }
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); passed++; console.log(`PASS ${name}`); }
function safe(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of [...Object.values(secrets), ...owners.map(owner => owner.key), ...owners.map(owner => owner.cookie.split("=")[1])]) assert(!text.includes(secret), "Secret reached a public result.");
  for (const field of ["providerModel", "providerCost", "markupMultiplier", "passwordHash", "keyHash", "tokenHash", "apiKeyEnv"]) assert(!text.includes(`"${field}"`), "Private field reached a public result.");
}
async function owner(balance = "10", role: "USER" | "ADMIN" = "USER") {
  const user = await db.user.create({ data: { name: "Playground fixture", email: `playground-${seed}-${owners.length}@example.test`, role, passwordHash: await hashPassword(uiPassword), wallet: { create: { balance } } } });
  const token = randomBytes(32).toString("base64url"), key = generateApiKey();
  await db.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), userAgent: "Playground fixture" } });
  await db.apiKey.create({ data: { userId: user.id, name: "Fixture", keyPrefix: key.keyPrefix, keyHash: key.keyHash } });
  const result = { id: user.id, cookie: `__Host-aihub-session=${token}`, key: key.key, email: user.email }; owners.push(result); return result;
}
async function model(provider: ModelProvider, mode: Mode = "success") {
  const result = await db.model.create({ data: { name: `${provider} ${mode}`, slug: `playground-${seed}-${models.length}`, provider, providerModel: `private-model-${seed}-${models.length}`, description: "Isolated Playground fixture", contextWindow: 4096,
    inputPricePerMillion: "2", outputPricePerMillion: "8", markupMultiplier: "1.5" } });
  models.push(result); modes.set(result.providerModel, mode); await risk.bindRouting(db, result, env);
  await db.providerChannel.updateMany({ where: { models: { some: { modelId: result.id } } }, data: { timeoutMs: mode === "timeout" ? 1000 : 90000 } });
  return result;
}
async function request(path: string, who?: Owner, options: { body?: unknown; raw?: string; worker?: number; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  const origin = origins[options.worker ?? 0], mutation = options.body !== undefined || options.raw !== undefined;
  return fetch(origin + path, { method: mutation ? "POST" : "GET", redirect: "manual", signal: options.signal ?? AbortSignal.timeout(20000), headers: {
    ...(who ? { Cookie: who.cookie } : {}), ...(mutation ? { Origin: origin, "Content-Type": "application/json" } : {}), ...options.headers,
  }, ...(mutation ? { body: options.raw ?? JSON.stringify(options.body) } : {}) });
}
function input(m: Model, submissionId = randomUUID()) { return { model: m.slug, submissionId, messages: [{ role: "user", content: "Playground private prompt fixture" }], max_tokens: 16 }; }
async function submit(who: Owner, m: Model, extra: Record<string, unknown> = {}, options: Parameters<typeof request>[2] = {}) { return request("/api/playground", who, { ...options, body: { ...input(m), ...extra } }); }
async function consume(response: Response) { assert.equal(response.status, 200); let text = ""; await readPlaygroundStream(response, new AbortController().signal, part => { text += part; }); assert.equal(text, content); return response.headers.get("x-request-id")!; }
async function stats(who: Owner, requestId: string): Promise<PlaygroundStats> { const response = await request(`/api/playground/runs/${requestId}`, who); assert.equal(response.status, 200); const result = await response.json(); safe(result); return result; }
async function terminal(who: Owner, requestId: string) { await waitFor(async () => (await stats(who, requestId)).status !== "PENDING"); return stats(who, requestId); }
async function child(executable: string, args: string[], source: string, extra: Partial<NodeJS.ProcessEnv>) {
  const processHandle = spawn(executable, args, { env: { ...process.env, ...extra }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = ""; processHandle.stdout.on("data", data => { stdout += data; }); processHandle.stderr.on("data", () => {});
  processHandle.stdin.end(source); const [exit] = await once(processHandle, "exit"); assert.equal(exit, 0, "Documentation SDK example failed; sensitive details suppressed."); safe(stdout); return stdout;
}
async function start() {
  for (const origin of [...origins, upstream]) assert(await fetch(origin, { signal: AbortSignal.timeout(200) }).then(() => false).catch(() => true), "Playground fixture ports must be free.");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" });
  fixture.listen(3162, "127.0.0.1"); await once(fixture, "listening");
  for (let worker = 0; worker < 2; worker++) {
    const handle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(3160 + worker)], { env: { ...env, APP_ORIGIN: origins[worker] }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    children.push(handle); handle.stdout.on("data", data => { output += data; }); handle.stderr.on("data", data => { output += data; });
    await waitFor(() => fetch(origins[worker] + "/api/auth/session").then(response => response.ok).catch(() => false));
  }
}
async function main() {
  await start();
  const a = await owner(), b = await owner(), admin = await owner("10", "ADMIN"), native: Model[] = [];
  for (const provider of providers) native.push(await model(provider, ui ? "slow" : "success"));
  if (ui) {
    await model("DEEPSEEK", "hold");
    writeFileSync(uiFile, JSON.stringify({ origin: origins[0], email: a.email, password: uiPassword, models: native.map(m => ({ slug: m.slug, name: m.name })) }));
    console.log(`Isolated Playground UI fixture ready on ${origins[0]}. Credentials saved in work/playground-ui-fixture.json (test accounts only).`);
    await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once("data", () => resolve()); process.once("SIGTERM", () => resolve()); process.once("SIGINT", () => resolve()); }); return;
  }
  await check("Anonymous and suspended sessions cannot open Playground or submit; public Gateway still requires an API key", async () => {
    const page = await request("/playground"); assert.equal(page.status, 307); assert.equal(new URL(page.headers.get("location")!, origins[0]).pathname, "/login");
    assert.equal((await submit({ ...a, cookie: "" }, native[0])).status, 401);
    await db.user.update({ where: { id: b.id }, data: { status: "SUSPENDED" } }); assert.equal((await submit(b, native[0])).status, 401); await db.user.update({ where: { id: b.id }, data: { status: "ACTIVE" } });
    const gateway = await request("/v1/chat/completions", a, { body: { model: native[0].slug, messages: [{ role: "user", content: "test" }], max_tokens: 16 }, headers: { "X-Playground-Run-Id": randomUUID() } }); assert.equal(gateway.status, 401);
  });
  await check("Session entry rejects CSRF, owner injection, invalid temperature, disabled models and oversized messages/body", async () => {
    const before = calls.length;
    assert.equal((await submit(a, native[0], {}, { headers: { Origin: "https://untrusted.example" } })).status, 403);
    assert.equal((await submit(a, native[0], { userId: b.id })).status, 400);
    assert.equal((await submit(a, native[0], { temperature: 0.7 })).status, 400);
    assert.equal((await submit(a, native[1], { temperature: 1.1 })).status, 400);
    assert.equal((await submit(a, native[3], { max_tokens: 5000 })).status, 400);
    assert.equal((await submit(a, native[3], { messages: [{ role: "user", content: "a".repeat(32769) }] })).status, 400);
    assert.equal((await request("/api/playground", a, { raw: " ".repeat(262145) })).status, 413);
    await db.model.update({ where: { id: native[0].id }, data: { enabled: false } }); assert.equal((await submit(a, native[0])).status, 404); await db.model.update({ where: { id: native[0].id }, data: { enabled: true } });
    assert.equal(calls.length, before);
  });
  for (const m of native) await check(`${m.provider} Session streaming uses native adapter, exact usage/cost and one ledger`, async () => {
    const before = await db.wallet.findUniqueOrThrow({ where: { userId: a.id } }), id = await consume(await submit(a, m, { ...(m.provider === "OPENAI" ? {} : { temperature: 0.5 }) }));
    const result = await terminal(a, id); assert.equal(result.status, "SUCCESS"); assert.equal(result.inputTokens, 12); assert.equal(result.outputTokens, 7); assert.equal(result.totalTokens, 19); assert.equal(result.actualCost, "0.00012"); assert.equal(result.currency, "CNY"); assert(result.latencyMs !== null && result.latencyMs >= 0);
    const row = await db.apiRequest.findUniqueOrThrow({ where: { requestId: id } }); assert.equal(row.source, "PLAYGROUND"); assert.equal(row.apiKeyId, null); assert.equal(row.modelSlug, m.slug);
    assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 1);
    const after = await db.wallet.findUniqueOrThrow({ where: { userId: a.id } }); assert(money(before.balance).minus(money(after.balance)).eq("0.00012")); assert(after.reservedBalance.isZero());
  });
  await check("Only the submission owner can read stats, including when a different owner is Admin", async () => {
    const submissionId = randomUUID(), id = await consume(await submit(a, native[3], { submissionId }));
    assert.equal((await request(`/api/playground/runs/${id}`, b)).status, 404); assert.equal((await request(`/api/playground/runs/${id}`, admin)).status, 404);
    assert.equal((await request(`/api/playground/runs/${id}?userId=${b.id}`, a)).status, 200);
    const recovered = await request(`/api/playground/submissions/${submissionId}`, a); assert.equal(recovered.status, 200); assert.equal((await recovered.json()).requestId, id);
    assert.equal((await request(`/api/playground/submissions/${submissionId}`, b)).status, 404);
  });
  await check("Ten duplicate submissions across two processes dispatch and debit exactly once; changed body cannot replay", async () => {
    const submissionId = randomUUID(), before = calls.length;
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => submit(a, native[3], { submissionId }, { worker: i % 2 })));
    assert.equal(responses.filter(response => response.ok).length, 1); assert.equal(responses.filter(response => response.status === 409).length, 9);
    const id = await consume(responses.find(response => response.ok)!); assert.equal(calls.length, before + 1);
    for (const response of responses.filter(response => !response.ok)) { const body = await response.json(); safe(body); assert.equal(body.requestId, id); }
    assert.equal((await submit(a, native[3], { submissionId, messages: [{ role: "user", content: "changed" }] })).status, 409);
    await Promise.all(Array.from({ length: 10 }, () => settleSuccess(a.id, id, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 1))); await settleFailure(a.id, id, "request_cancelled", 1);
    assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 1); assert.equal((await terminal(a, id)).actualCost, "0.00012");
  });
  await check("Insufficient balance returns 402 without upstream execution or a wallet charge", async () => {
    const zero = await owner("0"), before = calls.length, response = await submit(zero, native[3]); assert.equal(response.status, 402);
    const id = response.headers.get("x-request-id")!, result = await terminal(zero, id); assert.equal(result.status, "FAILED"); assert.equal(result.actualCost, "0"); assert.equal(result.errorCode, "insufficient_balance");
    assert.equal(calls.length, before); assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 0); assert((await db.wallet.findUniqueOrThrow({ where: { userId: zero.id } })).reservedBalance.isZero());
  });
  await check("Missing final usage is not estimated or charged and remains pending provider reconciliation", async () => {
    const m = await model("DEEPSEEK", "missing"), response = await submit(a, m), id = response.headers.get("x-request-id")!;
    await assert.rejects(() => readPlaygroundStream(response, new AbortController().signal, () => {}), (error: unknown) => error instanceof PlaygroundError && error.code === "usage_missing");
    const result = await terminal(a, id), row = await db.apiRequest.findUniqueOrThrow({ where: { requestId: id } }); assert.equal(result.actualCost, "0"); assert.equal(result.totalTokens, null); assert.equal(row.providerCostStatus, "PENDING_RECONCILIATION"); assert.equal(row.providerCost, null);
  });
  await check("Stop cancels the upstream, records failure and releases balance without charging incomplete output", async () => {
    const m = await model("DEEPSEEK", "hold"), cancellation = new AbortController(), response = await submit(a, m, {}, { signal: cancellation.signal }), id = response.headers.get("x-request-id")!;
    await assert.rejects(() => readPlaygroundStream(response, cancellation.signal, () => cancellation.abort()));
    const result = await terminal(a, id); assert.equal(result.status, "FAILED"); assert.equal(result.actualCost, "0"); await waitFor(() => closed.has(m.providerModel));
    assert((await db.wallet.findUniqueOrThrow({ where: { userId: a.id } })).reservedBalance.isZero()); assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 0);
  });
  await check("Provider timeout releases the hold and reports the true failed settlement", async () => {
    const m = await model("DEEPSEEK", "timeout"), response = await submit(a, m), id = response.headers.get("x-request-id")!;
    await assert.rejects(() => readPlaygroundStream(response, new AbortController().signal, () => {})); assert.equal((await terminal(a, id)).actualCost, "0");
    assert((await db.wallet.findUniqueOrThrow({ where: { userId: a.id } })).reservedBalance.isZero());
  });
  await check("Stop before response headers recovers the owned submission without replay or duplicate charge", async () => {
    const m = await model("DEEPSEEK", "headers"), submissionId = randomUUID(), cancellation = new AbortController();
    const pending = submit(a, m, { submissionId }, { signal: cancellation.signal });
    const rejected = assert.rejects(pending);
    await waitFor(() => calls.includes(m.providerModel)); cancellation.abort(); await rejected;
    const lookup = await request(`/api/playground/submissions/${submissionId}`, a); assert.equal(lookup.status, 200); const recovered: PlaygroundStats = await lookup.json();
    const result = await terminal(a, recovered.requestId); assert.equal(result.status, "FAILED"); assert.equal(result.actualCost, "0");
    assert.equal((await submit(a, m, { submissionId })).status, 409); assert.equal(calls.filter(value => value === m.providerModel).length, 1);
    assert((await db.wallet.findUniqueOrThrow({ where: { userId: a.id } })).reservedBalance.isZero());
  });
  await check("Playground and API keys share user RPM and TPM; rejections cannot reserve or deduct balance", async () => {
    const who = await owner(), before = calls.length;
    for (let i = 0; i < 60; i++) await admitRisk({ id: `seed-rpm-${randomUUID()}`, dimensions: [{ scope: "user", id: `chat-completions:${who.id}`, rpm: 60, tpm: 0 }] });
    assert.equal((await submit(who, native[3])).status, 429);
    assert.equal((await request("/v1/chat/completions", who, { body: { model: native[3].slug, messages: [{ role: "user", content: "test" }], max_tokens: 16 }, headers: { Authorization: `Bearer ${who.key}` } })).status, 429);
    const tpmUser = await owner(), permit = await admitRisk({ id: `seed-tpm-${randomUUID()}`, tokens: 200000, dimensions: [{ scope: "user", id: `chat-completions:${tpmUser.id}`, rpm: 0, tpm: 200000 }] });
    assert.equal((await submit(tpmUser, native[3])).status, 429); await finishRisk(permit, 200000);
    assert.equal(calls.length, before); assert((await db.wallet.findUniqueOrThrow({ where: { userId: who.id } })).balance.eq("10"));
  });
  await check("Twenty-five concurrent Session requests across processes admit ten, then release every reservation", async () => {
    const who = await owner(), m = await model("DEEPSEEK", "hold"), before = calls.length;
    const responses = await Promise.all(Array.from({ length: 25 }, (_, i) => submit(who, m, {}, { worker: i % 2 })));
    assert.equal(responses.filter(response => response.ok).length, 10); assert.equal(responses.filter(response => response.status === 429).length, 15); assert.equal(calls.length, before + 10);
    releases.splice(0).forEach(release => release());
    const ids = await Promise.all(responses.filter(response => response.ok).map(consume));
    assert((await db.wallet.findUniqueOrThrow({ where: { userId: who.id } })).reservedBalance.isZero()); assert.equal(await db.walletTransaction.count({ where: { requestId: { in: ids } } }), 10);
  });
  await check("Model parameter controls are conservative and public docs/models contain no private routing or costs", async () => {
    assert.equal(playgroundParameters({ provider: "DEEPSEEK", providerModel: "deepseek-reasoner", contextWindow: 4096 }).temperature, null);
    assert.equal(playgroundParameters(native[0]).temperature, null); assert.equal(playgroundParameters(native[1]).temperature?.max, 1);
    const page = await request("/playground", a); assert.equal(page.status, 200); const html = await page.text(); safe(html); assert(html.includes("Configuration"));
    const docs = await request("/docs"); assert.equal(docs.status, 200); const source = await docs.text(); safe(source); for (const section of docsSections) assert(source.includes(`id="${section.id}"`)); assert(source.includes(origins[0]));
  });
  await check("A configured but incompatible binding is excluded from the Playground selector", async () => {
    const m = await model("DEEPSEEK"); await db.model.update({ where: { id: m.id }, data: { contextWindow: 8192 } });
    const response = await request("/playground", a); assert.equal(response.status, 200); assert(!(await response.text()).includes(m.slug));
  });
  await check("Published Python, JavaScript and curl examples execute unchanged for normal and streamed responses", async () => {
    assert.doesNotThrow(() => execFileSync(python, ["-c", "import sys; assert sys.version_info.major == 3"], { stdio: "ignore", windowsHide: true, timeout: 10000 }), "Python 3 must be executable; set PYTHON_TEST_EXECUTABLE when needed.");
    assert(existsSync(resolve(pythonPath, "openai")), "Install the pinned SDK test environment into PYTHON_TEST_PATH.");
    for (const stream of [false, true]) {
      const examples = buildRequestExamples(origins[0] + "/v1", native[3].slug, stream), config = { AIHUB_API_KEY: b.key, PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" };
      const js = await child(process.execPath, ["--input-type=module", "-"], examples.javascript.code, config); assert(js.includes("Hello, AIHub.") && js.includes("19"));
      const py = await child(python, ["-"], examples.python.code, config); assert(py.includes("Hello, AIHub.") && py.includes("19"));
      const match = examples.curl.code.match(/-d '([\s\S]+)'$/)!;
      const curl = await child(process.platform === "win32" ? "curl.exe" : "curl", ["--silent", "--show-error", "--fail-with-body", ...(stream ? ["-N"] : []), origins[0] + "/v1/chat/completions", "-H", `Authorization: Bearer ${b.key}`, "-H", "Content-Type: application/json", "--data-binary", match[1]], "", {});
      assert(stream ? curl.includes("[DONE]") && curl.includes('"total_tokens":19') : JSON.parse(curl).usage.total_tokens === 19);
    }
  });
  await check("Logs and metadata contain no prompt, response or secret; Usage includes Session requests", async () => {
    await waitFor(async () => await db.apiRequest.count({ where: { userId: { in: owners.map(owner => owner.id) }, status: "PENDING" } }) === 0);
    for (const who of owners) { const wallet = await db.wallet.findUniqueOrThrow({ where: { userId: who.id } }); assert(wallet.reservedBalance.isZero()); assert(!wallet.balance.isNegative()); }
    for (const secret of [...Object.values(secrets), content, "Playground private prompt fixture"]) assert(!output.includes(secret));
    const response = await request("/api/dashboard/usage?range=24H", a); assert.equal(response.status, 200); const analytics = await response.json(); assert(JSON.stringify(analytics).includes("Playground"));
  });
  console.log(`Playground integration: ${passed} checks passed (Session, two processes, four native fixtures, billing, SDK documentation).`);
}
async function run() {
  try { await main(); }
  catch (error) {
    console.error(`FAIL ${activeCheck}; sensitive output suppressed.`);
    if (error instanceof Error) console.error(JSON.stringify({ kind: error.name, locations: error.stack?.split("\n").filter(line => line.trim().startsWith("at ")).slice(0, 6),
      ...(error instanceof assert.AssertionError ? { operator: error.operator, actual: typeof error.actual === "number" ? error.actual : undefined, expected: typeof error.expected === "number" ? error.expected : undefined } : {}) }));
    process.exitCode = 1;
  } finally {
    releases.splice(0).forEach(release => release());
    for (const handle of children) if (handle.exitCode === null) { const exited = once(handle, "exit"); handle.kill(); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]); }
    fixture.closeAllConnections(); if (fixture.listening) await new Promise<void>(resolve => fixture.close(() => resolve()));
    await db.user.deleteMany({ where: { id: { in: owners.map(owner => owner.id) } } }); await db.model.deleteMany({ where: { id: { in: models.map(model => model.id) } } });
    await risk.cleanupRouting(db); await closeRiskRedis(); await risk.cleanup(); await db.$disconnect(); await getDb().$disconnect();
    if (ui && existsSync(uiFile)) unlinkSync(uiFile);
  }
}
void run().catch(() => { console.error("Playground fixture cleanup failed."); process.exitCode = 1; });
