import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import OpenAI from "openai";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Model, type ModelProvider } from "../generated/prisma/client";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { getDb } from "../lib/server/db";
import { money } from "../lib/billing/money";
import { reserveRequest, settleSuccess, settleFailure } from "../lib/billing/wallet";
import { prepareRoute, openStreamRoute } from "../lib/ai/router/channels";
import { streamResponse } from "../lib/ai/stream-response";
import { GatewayError, type ChatCompletionInput } from "../lib/ai/types";
import { readSse, StreamRedactor } from "../lib/ai/providers/sse";
import { riskTestEnvironment } from "./risk-test-environment";
import { closeRiskRedis } from "../lib/risk/redis";

config({ quiet: true });
const risk = riskTestEnvironment("streaming"), databaseUrl = process.env.DATABASE_URL_TEST;
assert(databaseUrl && databaseUrl !== process.env.DATABASE_URL && new URL(databaseUrl).pathname === "/aihub_auth_test" && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname));
Object.assign(process.env, risk.env, { DATABASE_URL: databaseUrl });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 6 }), log: [] });
const seed = randomBytes(6).toString("hex"), origins = ["http://127.0.0.1:3150", "http://127.0.0.1:3151"], upstream = "http://127.0.0.1:3152";
const providers = ["OPENAI", "ANTHROPIC", "GOOGLE", "DEEPSEEK"] as const;
const secrets = Object.fromEntries(providers.map(p => [p, `fixture-stream-${p}-${randomBytes(20).toString("hex")}`])) as Record<ModelProvider, string>;
const env: NodeJS.ProcessEnv = { ...process.env, ...risk.env, DATABASE_URL: databaseUrl, NODE_ENV: "production", PAYMENTS_ENABLED: "false",
  ROUTER_MAX_RETRIES: "2", GATEWAY_API_KEY_RPM: "100000", GATEWAY_API_KEY_CONCURRENCY: "10", UPSTREAM_API_KEY: "" };
for (const p of providers) {
  const prefix = p === "GOOGLE" ? "GEMINI" : p;
  env[`${prefix}_API_KEY`] = secrets[p]; env[`${prefix}_BASE_URL`] = upstream + "/" + p.toLowerCase() + "/v1"; env[`${prefix}_TIMEOUT_MS`] = "2000";
}
env.DEEPSEEK_TESTA_API_KEY = secrets.DEEPSEEK; env.DEEPSEEK_TESTA_BASE_URL = upstream + "/deepseek-a/v1";
env.DEEPSEEK_TESTB_API_KEY = secrets.DEEPSEEK; env.DEEPSEEK_TESTB_BASE_URL = upstream + "/deepseek-b/v1";
Object.assign(process.env, env);
const children: ChildProcess[] = [], models: Model[] = [], users: string[] = [], extraChannels: string[] = [];
type Mode = "success" | "slow" | "hold" | "interrupt" | "known-interrupt" | "missing" | "bad-usage" | "rate" | "fail" | "headers-timeout" | "body-timeout" | "reflection" | "malformed" | "oversized" | "no-marker" | "snapshot" | "empty-usage" | "partial-usage" | "usage-only" | "tail" | "single";
const modes = new Map<string, Mode>(), calls: { model: string; path: string; stream: boolean }[] = [], replies: (() => void)[] = [], closedModels = new Set<string>();
const text = "Hello 流式 👋";
let output = "", activeCheck = "startup", passed = 0, userId = "", keyId = "", key = "";
const python = process.env.PYTHON_TEST_EXECUTABLE ?? (process.platform === "win32" ? "python" : "python3");
const pythonPath = resolve(process.env.PYTHON_TEST_PATH ?? "../../work/python-sdk");
type NativeFrame = { event?: string; data: unknown };
function usage(p: ModelProvider, outputTokens = 7) {
  return p === "ANTHROPIC" ? { input_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 5, output_tokens: outputTokens }
    : p === "GOOGLE" ? { promptTokenCount: 12, candidatesTokenCount: outputTokens - 3, thoughtsTokenCount: 3, totalTokenCount: 12 + outputTokens }
    : { prompt_tokens: 12, completion_tokens: outputTokens, total_tokens: 12 + outputTokens };
}
function normal(p: ModelProvider) {
  if (p === "ANTHROPIC") return { role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: usage(p) };
  if (p === "GOOGLE") return { candidates: [{ index: 0, content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: usage(p) };
  return { choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: usage(p) };
}
function frames(p: ModelProvider, mode: Mode): NativeFrame[] {
  if (p === "GOOGLE" && mode === "single") return [{ data: normal(p) }];
  const pieces = mode === "reflection" ? ["Hello ", secrets[p].slice(0, 14), secrets[p].slice(14), " safe"] : mode === "tail" ? ["Hello ", secrets[p].slice(0, -1)] : ["Hello ", "流式 ", "👋"];
  const u = mode === "bad-usage" ? { ...usage(p), [p === "GOOGLE" ? "promptTokenCount" : p === "ANTHROPIC" ? "input_tokens" : "prompt_tokens"]: -1 } : usage(p);
  const endUsage = mode === "missing" || mode === "usage-only" ? {} : { [p === "GOOGLE" ? "usageMetadata" : "usage"]: mode === "empty-usage" ? {} : mode === "partial-usage" ? { input_tokens: 5 } : u };
  if (p === "ANTHROPIC") return [
    { event: "message_start", data: { type: "message_start", message: { role: "assistant", usage: { ...usage(p), output_tokens: 1 } } } },
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
    ...pieces.map(piece => ({ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } } })),
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: null }, usage: { output_tokens: 3 } } },
    { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" }, ...endUsage } },
    { event: "message_stop", data: { type: "message_stop" } },
  ];
  if (p === "GOOGLE") return [
    ...pieces.map(piece => ({ data: { candidates: [{ index: 0, content: { role: "model", parts: [{ text: "private-thinking", thought: true }, { text: piece }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1, totalTokenCount: 13 } } })),
    { data: { candidates: [{ index: 0, content: { parts: [] }, finishReason: "STOP" }], ...endUsage } },
    ...(mode === "usage-only" ? [{ data: { usageMetadata: u } }] : []),
  ];
  const choice = (delta: unknown, reason: string | null = null) => ({ id: "private-upstream-id", model: "private-upstream-model", choices: [{ index: 0, delta, finish_reason: reason }], debug: secrets[p] });
  if (p === "DEEPSEEK" && mode !== "usage-only") return [
    { data: choice({ role: "assistant", content: "" }) }, ...pieces.map(piece => ({ data: { ...choice({ content: piece }), ...(mode === "snapshot" ? { usage: usage(p, 1) } : {}) } })),
    { data: { ...choice({ content: "" }, "stop"), ...(mode === "missing" || mode === "snapshot" ? {} : { usage: u }) } }, { data: "[DONE]" },
  ];
  return [{ data: choice({ role: "assistant", content: "" }) }, ...pieces.map(piece => ({ data: { ...choice({ content: piece }), ...(mode === "snapshot" ? { usage: usage(p, 1) } : {}) } })),
    { data: choice({}, "stop") }, ...(mode === "missing" || mode === "snapshot" ? [] : [{ data: { choices: [], usage: u } }]), { data: "[DONE]" }];
}
function encode(frame: NativeFrame) {
  const value = typeof frame.data === "string" ? frame.data : JSON.stringify(frame.data, null, 1);
  return Buffer.from(`${frame.event ? `event: ${frame.event}\r\n` : ""}${value.split("\n").map(line => `data: ${line}\r\n`).join("")}\r\n`);
}
const fixture = createServer(async (request, response) => {
  try {
    const path = request.url ?? "", p = path.includes("/anthropic/") ? "ANTHROPIC" : path.includes("/google/") ? "GOOGLE" : path.includes("/openai/") ? "OPENAI" : "DEEPSEEK";
    assert.equal(request.headers[p === "ANTHROPIC" ? "x-api-key" : p === "GOOGLE" ? "x-goog-api-key" : "authorization"], p === "ANTHROPIC" || p === "GOOGLE" ? secrets[p] : `Bearer ${secrets[p]}`);
    assert.equal(request.headers.cookie, undefined);
    const buffers: Buffer[] = []; for await (const chunk of request) buffers.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    const modelId = p === "GOOGLE" ? decodeURIComponent(path.split("/models/")[1].split(":")[0]) : body.model as string;
    const mode = modes.get((path.includes("deepseek-a") ? "a:" : path.includes("deepseek-b") ? "b:" : "") + modelId) ?? modes.get(modelId) ?? "success";
    const stream = p === "GOOGLE" ? path.includes(":streamGenerateContent?alt=sse") : body.stream === true;
    calls.push({ model: modelId, path, stream }); response.once("close", () => closedModels.add(modelId));
    if (["rate", "fail"].includes(mode)) { response.writeHead(mode === "rate" ? 429 : 500, { "Content-Type": "application/json", "Retry-After": "1" }).end(JSON.stringify({ error: { code: mode === "rate" ? "rate_limit_exceeded" : "private-error", message: secrets[p] } })); return; }
    if (mode === "headers-timeout") return;
    if (!stream) { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(normal(p))); return; }
    if (p === "OPENAI" || p === "DEEPSEEK") assert.equal(body.stream_options.include_usage, true);
    else if (p === "ANTHROPIC") assert.equal(body.stream_options, undefined);
    response.writeHead(200, { "Content-Type": "text/event-stream", "X-Secret": secrets[p] }); response.write(": keep-alive\r\n\r\n");
    if (mode === "malformed") { response.end("data: {not-json}\n\n"); return; }
    if (mode === "oversized") { response.end("data: " + "x".repeat(70000)); return; }
    const events = frames(p, mode);
    const deliver = async (items: NativeFrame[]) => {
      for (const frame of items) {
        if (response.destroyed) return;
        const data = encode(frame);
        // Deliberately split UTF-8 bytes, CRLF, JSON and SSE delimiters.
        for (let i = 0; i < data.length; i += 7) response.write(data.subarray(i, i + 7));
        if (mode === "slow") await new Promise(r => setTimeout(r, 50));
      }
      response.end();
    };
    if (["hold", "body-timeout", "interrupt"].includes(mode)) {
      const count = p === "ANTHROPIC" ? 3 : p === "GOOGLE" ? 1 : 2;
      for (const frame of events.slice(0, count)) response.write(encode(frame));
      if (mode === "interrupt") { response.end(); return; }
      if (mode === "hold") replies.push(() => { void deliver(events.slice(count)); });
      return;
    }
    if (mode === "known-interrupt" || mode === "no-marker") {
      if (p === "GOOGLE") { response.write(encode(events[0])); response.end(); }
      else { for (const frame of events.slice(0, mode === "known-interrupt" ? -1 : p === "ANTHROPIC" ? -2 : -3)) response.write(encode(frame)); response.end(); }
      return;
    }
    await deliver(events);
  } catch { if (!response.destroyed) response.destroy(); }
});
async function waitFor(check: () => Promise<boolean> | boolean, ms = 20000) {
  const deadline = Date.now() + ms;
  while (!await check()) { assert(Date.now() < deadline, "Fixture wait exceeded its deadline."); await new Promise(r => setTimeout(r, 20)); }
}
async function check(name: string, run: () => Promise<void>) { activeCheck = name; await run(); passed++; console.log(`PASS ${name}`); }
async function model(p: ModelProvider, mode: Mode = "success", timeoutMs = 2000) {
  const m = await db.model.create({ data: { slug: `stream-${seed}-${models.length}`, provider: p, providerModel: `upstream-${seed}-${models.length}`, name: "Streaming fixture", description: "Isolated native SSE", contextWindow: 4096,
    inputPricePerMillion: "2", outputPricePerMillion: "8", markupMultiplier: "1.5" } }); models.push(m); modes.set(m.providerModel, mode);
  await risk.bindRouting(db, m, env); await db.providerChannel.updateMany({ where: { models: { some: { modelId: m.id } } }, data: { timeoutMs, concurrency: 10 } }); return m;
}
async function chat(m: Model, stream = true, extra: Record<string, unknown> = {}, index = 0, signal?: AbortSignal, apiKey = key) {
  return fetch(origins[index] + "/v1/chat/completions", { method: "POST", signal: signal ?? AbortSignal.timeout(20000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: m.slug, messages: [{ role: "user", content: "SDK fixture" }], max_tokens: 16, stream, ...(stream ? { stream_options: { include_usage: true } } : {}), ...extra }) });
}
type PublicFrame = { id?: string; object?: string; model?: string; choices?: { delta: { role?: string; content?: string; refusal?: string }; finish_reason: string | null }[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null; error?: { code: string; message: string } };
function assertSafe(value: unknown) {
  const data = JSON.stringify(value);
  for (const secret of [key, ...Object.values(secrets), "private-upstream-id", "private-upstream-model", "private-thinking"]) if (secret) assert(!data.includes(secret), "Private data cannot be exposed.");
}
async function consume(response: Response) {
  assert.equal(response.status, 200); assert(response.headers.get("content-type")?.startsWith("text/event-stream")); assert.equal(response.headers.get("x-secret"), null);
  const frames: PublicFrame[] = []; let done = 0, content = "", firstAt = 0;
  for await (const event of readSse(response, new AbortController().signal)) {
    if (event.data === "[DONE]") { done++; continue; }
    assert.equal(done, 0); const value: PublicFrame = JSON.parse(event.data); assertSafe(value); frames.push(value);
    const part = value.choices?.[0]?.delta.content ?? ""; content += part; if (part && !firstAt) firstAt = performance.now();
  }
  return { frames, content, done, firstAt, endAt: performance.now(), requestId: response.headers.get("x-request-id")! };
}
async function record(id: string) { return db.apiRequest.findUniqueOrThrow({ where: { requestId: id }, include: { attempts: true } }); }
async function failed(id: string, known = false) {
  await waitFor(async () => (await record(id)).status === "FAILED"); const row = await record(id);
  assert(row.userCost?.isZero()); assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 0);
  assert.equal(row.providerCostStatus, known ? "KNOWN" : "PENDING_RECONCILIATION");
  assert(known ? row.providerCost?.gt(0) : row.providerCost === null); assert((await db.wallet.findUniqueOrThrow({ where: { userId } })).reservedBalance.isZero());
  return row;
}
async function child(executable: string, args: string[], input: string, config: Partial<NodeJS.ProcessEnv> = {}) {
  const handle = spawn(executable, args, { windowsHide: true, env: { ...process.env, ...config }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = ""; handle.stdout.on("data", data => { stdout += data; }); handle.stderr.on("data", data => { stderr += data; });
  handle.stdin.end(input); const [code] = await once(handle, "exit"); assert.equal(code, 0, "SDK or curl child exited unsuccessfully (details suppressed).");
  assertSafe(stdout); assertSafe(stderr); return stdout;
}
async function direct(m: Model) {
  const requestId = randomUUID(), cancellation = new AbortController();
  const input: ChatCompletionInput = { model: m.slug, messages: [{ role: "user", content: "SDK fixture" }], max_tokens: 16, stream: true };
  const budget = await reserveRequest(requestId, { userId, apiKeyId: keyId }, m, input);
  const route = await openStreamRoute(await prepareRoute(m), budget.boundedInput, { requestId, signal: cancellation.signal,
    estimatedTokens: budget.estimatedInputTokens + budget.maxOutputTokens, onDispatch() {} });
  const transport = streamResponse(route, input, requestId, cancellation, async outcome => {
    if (outcome.error) { await settleFailure(userId, requestId, outcome.error.code, 1, outcome.usage); return outcome.error; }
    const row = await settleSuccess(userId, requestId, outcome.usage!, 1, cancellation.signal);
    return row.status === "SUCCESS" ? undefined : new GatewayError(499, "The request was cancelled.", "invalid_request_error", row.errorCode!);
  });
  return { ...transport, requestId, cancellation };
}
async function lockBarrier(table: "Wallet" | "ProviderChannel" | "WalletTransaction", id?: string) {
  let unlock!: () => void, ready!: () => void;
  const waiting = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { unlock = resolve; });
  const transaction = db.$transaction(async tx => {
    if (table === "Wallet") await tx.$queryRaw`SELECT id FROM "Wallet" WHERE "userId" = ${id}::uuid FOR UPDATE`;
    else if (table === "ProviderChannel") await tx.$queryRaw`SELECT id FROM "ProviderChannel" WHERE id = ${id}::uuid FOR UPDATE`;
    else await tx.$executeRaw`LOCK TABLE "WalletTransaction" IN SHARE ROW EXCLUSIVE MODE`;
    ready(); await gate;
  }, { timeout: 15000 });
  await waiting; return async () => { unlock(); await transaction; };
}
async function waitForLock(table: string) {
  await waitFor(async () => {
    const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${table}%`}`;
    return rows[0].count > BigInt(0);
  });
}
async function main() {
  assert.doesNotThrow(() => execFileSync(python, ["-c", "import sys; assert sys.version_info.major == 3"], { stdio: "ignore", windowsHide: true, timeout: 10000 }), "Python 3 must be executable; set PYTHON_TEST_EXECUTABLE when needed.");
  assert(existsSync(resolve(pythonPath, "openai")), "Install scripts/requirements-sdk.txt into PYTHON_TEST_PATH.");
  for (const address of [...origins, upstream]) assert(await fetch(address, { signal: AbortSignal.timeout(300) }).then(() => false).catch(() => true), "Streaming fixture ports must be free.");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" });
  fixture.listen(3152, "127.0.0.1"); await once(fixture, "listening");
  for (let i = 0; i < 2; i++) {
    const handle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(3150 + i)], { env: { ...env, APP_ORIGIN: origins[i] }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(handle);
    handle.stdout.on("data", data => { output += data; }); handle.stderr.on("data", data => { output += data; });
    await waitFor(() => fetch(origins[i] + "/api/auth/session").then(r => r.ok).catch(() => false));
  }
  const user = await db.user.create({ data: { name: "SSE fixture", email: `sse-${seed}@example.test`, passwordHash: "unusable-fixture-password", wallet: { create: { balance: "10" } } } }); userId = user.id; users.push(userId);
  const generated = generateApiKey(); key = generated.key;
  const stored = await db.apiKey.create({ data: { userId, name: "SSE fixture", keyHash: generated.keyHash, keyPrefix: generated.keyPrefix } }); keyId = stored.id;
  const sdkModels: Model[] = [];
  for (const p of providers) {
    await check(`${p} normal and incremental native SSE return normalized content, final usage and one exact ledger`, async () => {
      const m = await model(p); sdkModels.push(m); const json = await chat(m, false); assert.equal(json.status, 200); const body = await json.json(); assertSafe(body); assert.equal(body.usage.total_tokens, 19);
      const response = await consume(await chat(m)); assert.equal(response.content, text); assert.equal(response.done, 1);
      assert(response.frames.every(f => f.model === m.slug && f.id === `chatcmpl-${response.requestId}` && f.object === "chat.completion.chunk"));
      assert.equal(response.frames.at(-2)?.choices?.[0].finish_reason, "stop"); assert.equal(response.frames.at(-1)?.choices?.length, 0); assert.equal(response.frames.at(-1)?.usage?.total_tokens, 19);
      const row = await record(response.requestId); assert.equal(row.status, "SUCCESS"); assert.equal(row.totalTokens, 19); assert.equal(row.userCost?.toFixed(20), "0.00012000000000000000");
      assert.equal(row.providerCost?.toFixed(20), "0.00008000000000000000"); assert.equal(await db.walletTransaction.count({ where: { requestId: row.requestId } }), 1); assert.equal(row.attempts.length, 1);
    });
  }
  await check("Official JavaScript OpenAI SDK handles all four providers without custom parsing", async () => {
    const client = new OpenAI({ baseURL: origins[0] + "/v1", apiKey: key, maxRetries: 0 });
    for (const m of sdkModels) {
      const request = { model: m.slug, messages: [{ role: "user" as const, content: "SDK fixture" }], max_tokens: 16 };
      const normal = await client.chat.completions.create(request); assert.equal(normal.choices[0].message.content, text); assert.equal(normal.usage?.total_tokens, 19);
      const stream = await client.chat.completions.create({ ...request, stream: true, stream_options: { include_usage: true } }); let content = "", total = 0;
      for await (const chunk of stream) { assert.equal(chunk.model, m.slug); content += chunk.choices[0]?.delta.content ?? ""; total = chunk.usage?.total_tokens ?? total; }
      assert.equal(content, text); assert.equal(total, 19);
    }
  });
  await check("Official Python OpenAI SDK handles normal and streamed responses for four model providers", async () => {
    const result = JSON.parse(await child(python, ["scripts/test-sdk-python.py"], JSON.stringify({ apiKey: key, baseURL: origins[0] + "/v1", models: sdkModels.map(m => m.slug) }), { PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" }));
    assert.equal(result.models, 4); assert(result.stream && result.normal && result.authentication);
  });
  await check("curl reads ordinary JSON and SSE DONE, using credentials only through stdin", async () => {
    for (const m of sdkModels) for (const stream of [false, true]) {
      const body = JSON.stringify({ model: m.slug, messages: [{ role: "user", content: "SDK fixture" }], max_tokens: 16, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) });
      const escaped = body.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      const result = await child(process.platform === "win32" ? "curl.exe" : "curl", ["--config", "-"], `url = "${origins[0]}/v1/chat/completions"\nheader = "Authorization: Bearer ${key}"\nheader = "Content-Type: application/json"\ndata = "${escaped}"\nsilent\nshow-error\nfail-with-body\nno-buffer\n`);
      assert(stream ? result.includes("data: [DONE]") && result.includes('"total_tokens":19') : JSON.parse(result).usage.total_tokens === 19);
    }
  });
  await check("The supplied JavaScript, Python and curl examples execute against the platform", async () => {
    const config = { AIHUB_API_KEY: key, AIHUB_BASE_URL: origins[0] + "/v1", AIHUB_MODEL: sdkModels[3].slug, PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" };
    assert((await child(process.execPath, ["examples/chat.mjs"], "", config)).includes("Usage:"));
    assert((await child(python, ["examples/chat.py"], "", config)).includes("Usage:"));
    assert((await child("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", "examples/chat-curl.ps1"], "", config)).includes("data: [DONE]"));
  });
  await check("Content reaches the client before upstream completion and usage can remain private", async () => {
    const m = await model("DEEPSEEK", "slow"); const result = await consume(await chat(m, true, { stream_options: { include_usage: false } }));
    assert.equal(result.content, text); assert(result.firstAt < result.endAt - 100); assert.equal(result.done, 1); assert(result.frames.every(f => f.usage === undefined));
    assert.equal((await record(result.requestId)).totalTokens, 19);
  });
  await check("Invalid keys, revoked keys and insufficient balances fail before streaming and upstream work", async () => {
    const m = sdkModels[3], before = calls.length;
    const invalid = await chat(m, true, {}, 0, undefined, "invalid-fixture-key"); assert.equal(invalid.status, 401); assert.equal((await invalid.json()).error.code, "invalid_api_key");
    await db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } }); assert.equal((await chat(m)).status, 401); await db.apiKey.update({ where: { id: keyId }, data: { revokedAt: null } });
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } }); await db.wallet.update({ where: { userId }, data: { balance: "0" } });
    assert.equal((await chat(m)).status, 402); await db.wallet.update({ where: { userId }, data: { balance: wallet.balance } }); assert.equal(calls.length, before);
  });
  for (const p of providers) await check(`${p} interruptions and missing final usage release holds without estimated billing`, async () => {
    for (const mode of ["interrupt", "missing", "bad-usage", "no-marker"] as const) {
      const m = await model(p, mode); const result = await consume(await chat(m)); assert.equal(result.done, 0); assert(result.frames.at(-1)?.error); await failed(result.requestId);
    }
  });
  await check("Authoritative usage received before interruption retains provider cost but never charges the user", async () => {
    for (const p of ["OPENAI", "ANTHROPIC", "DEEPSEEK"] as const) {
      const m = await model(p, "known-interrupt"), result = await consume(await chat(m)); assert.equal(result.done, 0); await failed(result.requestId, true);
    }
  });
  await check("Nonterminal OpenAI usage and incomplete Anthropic terminal usage can never authorize a charge", async () => {
    for (const p of ["OPENAI", "DEEPSEEK"] as const) { const result = await consume(await chat(await model(p, "snapshot"))); assert.equal(result.done, 0); await failed(result.requestId); }
    for (const mode of ["empty-usage", "partial-usage"] as const) { const result = await consume(await chat(await model("ANTHROPIC", mode))); assert.equal(result.done, 0); await failed(result.requestId); }
    const result = await consume(await chat(await model("GOOGLE", "usage-only"))); assert.equal(result.done, 1); assert.equal((await record(result.requestId)).totalTokens, 19);
  });
  await check("DeepSeek accepts confirmed finish-choice usage and canonical usage-only terminal chunks", async () => {
    for (const mode of ["success", "usage-only"] as const) {
      const result = await consume(await chat(await model("DEEPSEEK", mode))); assert.equal(result.done, 1);
      assert.equal(result.frames.at(-1)?.choices?.length, 0); assert.equal((await record(result.requestId)).totalTokens, 19);
      assert.equal(await db.walletTransaction.count({ where: { requestId: result.requestId } }), 1);
    }
  });
  await check("Provider header and body timeouts close streams, release balance and preserve unknown cost", async () => {
    const headers = await model("DEEPSEEK", "headers-timeout", 150), response = await chat(headers); assert.equal(response.status, 504); const id = response.headers.get("x-request-id")!; assert.equal((await response.json()).error.code, "provider_timeout"); await failed(id);
    const body = await model("DEEPSEEK", "body-timeout", 250), streamed = await consume(await chat(body)); assert.equal(streamed.frames.at(-1)?.error?.code, "provider_timeout"); assert.equal(streamed.done, 0); await failed(streamed.requestId);
  });
  await check("Client disconnect cancels transport promptly, releases both limits and never replays", async () => {
    const m = await model("DEEPSEEK", "hold"), abort = new AbortController(); const response = await chat(m, true, {}, 0, abort.signal), id = response.headers.get("x-request-id")!;
    const reader = response.body!.getReader(); await reader.read(); const before = calls.length; abort.abort(); await reader.cancel().catch(() => {});
    await waitFor(() => closedModels.has(m.providerModel)); const row = await failed(id); assert.equal(row.errorCode, "request_cancelled"); assert.equal(calls.length, before);
    replies.splice(0).forEach(reply => reply()); assert.equal((await chat(sdkModels[3], false)).status, 200);
  });
  await check("Cancellation while attempt completion or wallet settlement is blocked releases known-cost holds", async () => {
    for (const table of ["ProviderChannel", "Wallet"] as const) {
      const m = await model("DEEPSEEK", "hold", 10000), abort = new AbortController(), response = await chat(m, true, {}, 0, abort.signal);
      const id = response.headers.get("x-request-id")!, consuming = consume(response).catch(() => undefined);
      const row = await record(id), before = await db.wallet.findUniqueOrThrow({ where: { userId } });
      const release = await lockBarrier(table, table === "Wallet" ? userId : row.attempts[0].channelId!);
      try {
        replies.splice(0).forEach(reply => reply()); await waitForLock(table); abort.abort();
        await new Promise(resolve => setTimeout(resolve, 80));
      } finally { await release(); }
      await consuming; const ended = await failed(id, true); assert.equal(ended.errorCode, "request_cancelled");
      assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20), before.balance.toFixed(20));
    }
  });
  await check("Cancellation before transaction commit rolls back an in-progress wallet debit and ledger insert", async () => {
    const m = sdkModels[3], id = randomUUID(), abort = new AbortController(), before = await db.wallet.findUniqueOrThrow({ where: { userId } });
    await reserveRequest(id, { userId, apiKeyId: keyId }, m, { model: m.slug, messages: [{ role: "user", content: "SDK fixture" }], max_tokens: 16 });
    const release = await lockBarrier("WalletTransaction"), settling = settleSuccess(userId, id, { inputTokens: 12, outputTokens: 7, totalTokens: 19 }, 1, abort.signal);
    try { await waitForLock("WalletTransaction"); abort.abort(); } finally { await release(); }
    assert.equal((await settling).status, "FAILED"); await failed(id, true);
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20), before.balance.toFixed(20));
  });
  await check("Provider deadline settles a backpressured stream even when its body is never consumed", async () => {
    const m = await model("DEEPSEEK", "hold", 300), transport = await direct(m), started = performance.now();
    await transport.completion; assert(performance.now() - started < 2500); assert.equal((await failed(transport.requestId)).errorCode, "provider_timeout");
    replies.splice(0).forEach(reply => reply());
  });
  await check("Disconnect at a redactor tail retains final provider usage without charging the user", async () => {
    const m = await model("DEEPSEEK", "tail", 10000), transport = await direct(m), reader = transport.response.body!.getReader();
    const release = await lockBarrier("Wallet", userId);
    let cancelled: Promise<void> | undefined;
    try {
      for (;;) {
        const event = await reader.read(); assert(!event.done);
        const text = new TextDecoder().decode(event.value);
        assert(!text.includes(secrets.DEEPSEEK.slice(0, 7)));
        if (text.includes("[REDACTED]")) break;
      }
      transport.cancellation.abort(); cancelled = reader.cancel();
    } finally { await release(); }
    await cancelled;
    await transport.completion; assert.equal((await failed(transport.requestId, true)).totalTokens, 19);
  });
  await check("A single terminal Gemini frame retains confirmed usage when cancelled at the initial role", async () => {
    const m = await model("GOOGLE", "single", 10000), transport = await direct(m);
    transport.cancellation.abort(); await transport.completion;
    assert.equal((await failed(transport.requestId, true)).totalTokens, 19);
  });
  await check("Official JavaScript SDK surfaces streamed errors and aborts rather than reporting successful completion", async () => {
    const client = new OpenAI({ baseURL: origins[0] + "/v1", apiKey: key, maxRetries: 0 });
    const interrupted = await model("DEEPSEEK", "interrupt");
    const stream = await client.chat.completions.create({ model: interrupted.slug, messages: [{ role: "user", content: "SDK fixture" }], max_tokens: 16, stream: true });
    await assert.rejects(async () => { for await (const chunk of stream) assertSafe(chunk); }, (error: unknown) => error instanceof OpenAI.APIError && error.code === "streaming_interrupted");
    const pythonResult = JSON.parse(await child(python, ["scripts/test-sdk-python.py"], JSON.stringify({ apiKey: key, baseURL: origins[0] + "/v1", models: [sdkModels[3].slug], errorModel: interrupted.slug }), { PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" }));
    assert(pythonResult.streamingError);
    const held = await model("DEEPSEEK", "hold"), next = await client.chat.completions.create({ model: held.slug, messages: [{ role: "user", content: "SDK fixture" }], max_tokens: 16, stream: true });
    for await (const chunk of next) { assertSafe(chunk); next.controller.abort(); break; }
    await waitFor(async () => { const row = await db.apiRequest.findFirst({ where: { userId, modelId: held.id } }); return row?.status === "FAILED"; });
    const row = await db.apiRequest.findFirstOrThrow({ where: { userId, modelId: held.id } }); await failed(row.requestId); replies.splice(0).forEach(reply => reply());
  });
  await check("Safe 429 can switch compatible channels before output; ambiguous 500 cannot", async () => {
    for (const mode of ["rate", "fail"] as const) {
      const m = await model("DEEPSEEK"); await db.modelChannel.deleteMany({ where: { modelId: m.id } });
      for (const path of ["a", "b"]) {
        const channel = await db.providerChannel.create({ data: { code: `stream-${seed}-${mode}-${path}`, name: "Fallback fixture", provider: "DEEPSEEK", apiKeyEnv: `DEEPSEEK_TEST${path.toUpperCase()}_API_KEY`, baseUrlEnv: `DEEPSEEK_TEST${path.toUpperCase()}_BASE_URL`, priority: path === "a" ? 1 : 100, rpm: 100000, tpm: 100000000, concurrency: 10 } }); extraChannels.push(channel.id);
        await db.modelChannel.create({ data: { channelId: channel.id, modelId: m.id, providerModel: m.providerModel, contextWindow: m.contextWindow, inputPricePerMillion: "2", outputPricePerMillion: "8" } });
      }
      modes.set("a:" + m.providerModel, mode); modes.set("b:" + m.providerModel, "success");
      const response = await chat(m);
      if (mode === "rate") { const result = await consume(response); assert.equal(result.done, 1); const row = await record(result.requestId); assert.equal(row.attempts.length, 2); assert.equal(await db.walletTransaction.count({ where: { requestId: row.requestId } }), 1); }
      else { assert.equal(response.status, 502); const id = response.headers.get("x-request-id")!; await response.json(); const row = await failed(id); assert.equal(row.attempts.length, 1); }
    }
  });
  await check("After the first delta an interrupted stream never switches or concatenates another channel", async () => {
    const m = await model("DEEPSEEK", "interrupt"); const primary = await db.providerChannel.findFirstOrThrow({ where: { models: { some: { modelId: m.id } } } });
    await db.providerChannel.update({ where: { id: primary.id }, data: { idempotentRequests: true } });
    const backup = await db.providerChannel.create({ data: { code: `stream-${seed}-started-backup`, name: "Compatible backup", provider: "DEEPSEEK", apiKeyEnv: "DEEPSEEK_TESTB_API_KEY", baseUrlEnv: "DEEPSEEK_TESTB_BASE_URL", priority: 500 } }); extraChannels.push(backup.id);
    await db.modelChannel.create({ data: { modelId: m.id, channelId: backup.id, providerModel: m.providerModel, contextWindow: m.contextWindow, inputPricePerMillion: "2", outputPricePerMillion: "8" } }); modes.set("b:" + m.providerModel, "success");
    const before = calls.length, result = await consume(await chat(m)); assert.equal(result.done, 0); assert.equal(calls.length - before, 1); assert.equal((await failed(result.requestId)).attempts.length, 1);
  });
  await check("Malformed and oversized events cannot expose errors or bypass bounded parsing", async () => {
    for (const mode of ["malformed", "oversized"] as const) { const m = await model("DEEPSEEK", mode), response = await chat(m); assert.equal(response.status, 502); const id = response.headers.get("x-request-id")!; assertSafe(await response.json()); await failed(id); }
  });
  await check("Secrets split across deltas are redacted without buffering ordinary tokens", async () => {
    for (const p of providers) { const m = await model(p, "reflection"), result = await consume(await chat(m)); assert.equal(result.content, "Hello [REDACTED] safe"); assert.equal(result.done, 1); }
    const redactor = new StreamRedactor("sk-fixture-secret"); assert.equal(redactor.push("ordinary text"), "ordinary text"); assert.equal(redactor.push("sk-fixt"), ""); assert.equal(redactor.push("ure-secret"), "[REDACTED]");
    const unfinished = new StreamRedactor("sk-fixture-secret");
    assert.equal(unfinished.push("sk-fixture-secre"), "");
    assert.equal(unfinished.flush(), "[REDACTED]");
    assert.equal(unfinished.flush(), "");
    const mismatched = new StreamRedactor("sk-fixture-secret");
    assert.equal(mismatched.push("sk-fixture-secre"), "");
    assert.equal(mismatched.push("x"), "[REDACTED]x");
    const embedded = new StreamRedactor("sk-fixture-secret");
    assert.equal(embedded.push("Hello sk-fixture-secrex safe"), "Hello [REDACTED]x safe");
    const ordinary = new StreamRedactor("sk-fixture-secret");
    assert.equal(ordinary.push("ordinary words"), "ordinary word");
    assert.equal(ordinary.flush(), "s");
    const sharedWord = new StreamRedactor("fixture-OPENAI-private-secret");
    assert.equal(sharedWord.push("Hello fixture"), "Hello ");
    assert.equal(sharedWord.flush(), "fixture");
  });
  await check("Two processes keep 10 streams admitted, reject concurrent excess and settle each once", async () => {
    const m = await model("DEEPSEEK", "hold", 15000), before = calls.length;
    const pending = Array.from({ length: 25 }, (_, i) => chat(m, true, {}, i % 2)); const responses = await Promise.all(pending);
    assert.equal(responses.filter(r => r.status === 200).length, 10); assert.equal(responses.filter(r => r.status === 429).length, 15); assert.equal(calls.length - before, 10);
    assert((await db.wallet.findUniqueOrThrow({ where: { userId } })).reservedBalance.gt(0)); replies.splice(0).forEach(reply => reply());
    const ids: string[] = []; for (const response of responses) { if (response.status === 200) { const result = await consume(response); assert.equal(result.done, 1); ids.push(result.requestId); } else await response.json(); }
    assert.equal(await db.walletTransaction.count({ where: { requestId: { in: ids } } }), 10);
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } }); assert(wallet.reservedBalance.isZero()); assert(!wallet.balance.isNegative());
  });
  await check("Duplicate settlement after streaming cannot change its charge, usage or terminal state", async () => {
    const result = await consume(await chat(sdkModels[3])), before = await db.wallet.findUniqueOrThrow({ where: { userId } });
    await Promise.all(Array.from({ length: 10 }, () => settleSuccess(userId, result.requestId, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 1)));
    await settleFailure(userId, result.requestId, "request_cancelled", 1); assert.equal(await db.walletTransaction.count({ where: { requestId: result.requestId } }), 1);
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20), before.balance.toFixed(20)); assert.equal((await record(result.requestId)).totalTokens, 19);
  });
  await check("Every request releases holds and audit logs omit keys, prompts and raw stream contents", async () => {
    await waitFor(async () => await db.apiRequest.count({ where: { userId, status: "PENDING" } }) === 0);
    assert((await db.wallet.findUniqueOrThrow({ where: { userId } })).reservedBalance.isZero());
    const rows = await db.apiRequest.findMany({ where: { userId, status: "SUCCESS" }, include: { transaction: true } });
    assert(rows.every(r => r.transaction && r.userCost && money(r.transaction.amount).eq(money(r.userCost).negated())));
    for (const secret of [key, ...Object.values(secrets), text, "SDK fixture"]) assert(!output.includes(secret));
  });
  console.log(`Streaming and SDK integration: ${passed} checks passed (official JavaScript/Python SDKs, curl, two servers, four simulated native providers).`);
}
async function run() {
  try { await main(); } catch (error) {
    console.error(`FAIL ${activeCheck}; secrets and response bodies suppressed.`);
    if (error instanceof Error) console.error(JSON.stringify({ kind: error.name,
      locations: error.stack?.split("\n").filter(line => line.trim().startsWith("at ")).slice(-4),
      ...(error instanceof assert.AssertionError ? { operator: error.operator, actual: typeof error.actual === "number" ? error.actual : undefined, expected: typeof error.expected === "number" ? error.expected : undefined } : {}) }));
    process.exitCode = 1;
  }
  finally {
    replies.splice(0).forEach(reply => reply());
    for (const child of children) if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]); }
    fixture.closeAllConnections(); if (fixture.listening) await new Promise<void>(resolve => fixture.close(() => resolve()));
    await db.user.deleteMany({ where: { id: { in: users } } }); await db.model.deleteMany({ where: { id: { in: models.map(m => m.id) } } });
    await risk.cleanupRouting(db); await db.providerChannel.deleteMany({ where: { id: { in: extraChannels } } }); await risk.cleanup(); await closeRiskRedis(); await db.$disconnect(); await getDb().$disconnect();
  }
}
void run().catch(() => { console.error("Streaming fixture cleanup failed."); process.exitCode = 1; });
