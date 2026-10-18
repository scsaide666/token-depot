import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Model, type ModelProvider } from "../generated/prisma/client";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { OpenAIProvider } from "../lib/ai/providers/openai";
import { AnthropicProvider } from "../lib/ai/providers/anthropic";
import { GeminiProvider } from "../lib/ai/providers/gemini";
import { DeepSeekProvider } from "../lib/ai/providers/deepseek";
import { GatewayError, type AIProvider, type ChatCompletionInput } from "../lib/ai/types";
import { riskTestEnvironment } from "./risk-test-environment";

config({ quiet: true });
const risk = riskTestEnvironment("providers");
const url = process.env.DATABASE_URL_TEST;
assert(url && url !== process.env.DATABASE_URL);
const location = new URL(url);
assert(["127.0.0.1", "localhost"].includes(location.hostname) && location.pathname === "/aihub_auth_test");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c timezone=UTC", max: 4 }), log: [] });
const origin = "http://127.0.0.1:3134", fixtureOrigin = "http://127.0.0.1:3135", seed = randomBytes(8).toString("hex");
const providers = ["OPENAI", "ANTHROPIC", "GOOGLE", "DEEPSEEK"] as const;
const keys = Object.fromEntries(providers.map((p) => [p, `fixture-${p}-${randomBytes(20).toString("hex")}`])) as Record<ModelProvider, string>;
const paths = { OPENAI: "/openai/v1/chat/completions", ANTHROPIC: "/anthropic/v1/messages", GOOGLE: "/gemini/v1beta/models/", DEEPSEEK: "/deepseek/v1/chat/completions" };
const configFor = (provider: ModelProvider) => ({ apiKey: keys[provider], baseUrl: fixtureOrigin + (provider === "GOOGLE" ? "/gemini/v1beta" : `/${provider.toLowerCase()}/v1`), timeoutMs: "500" });
const adapters: Record<ModelProvider, AIProvider> = { OPENAI: new OpenAIProvider(configFor("OPENAI")), ANTHROPIC: new AnthropicProvider(configFor("ANTHROPIC")), GOOGLE: new GeminiProvider(configFor("GOOGLE")), DEEPSEEK: new DeepSeekProvider(configFor("DEEPSEEK")) };
const calls: { provider: ModelProvider; path: string; headers: IncomingHttpHeaders; body: Record<string, unknown>; mode: string }[] = [];
const models: Model[] = [];
let userId: string | undefined, keyId: string | undefined, secret = "", server: ChildProcess | undefined, output = "", activeCheck = "startup", passed = 0, redirects = 0;
const expectedUsage = { inputTokens: 12, outputTokens: 7, totalTokens: 19 };

function payload(provider: ModelProvider, mode = "success"): Record<string, unknown> {
  const text = mode === "reflection" ? `Hello ${keys[provider]}`
    : mode === "partial-reflection" ? `Hello ${keys[provider].slice(0, -1)}x` : "Hello fixture";
  if (provider === "ANTHROPIC") return {
    id: "private-provider-id", type: "message", role: "assistant", model: "private-model", debug: keys[provider],
    content: [{ type: "thinking", thinking: "hidden-thinking", signature: "private-signature" }, { type: "text", text }],
    stop_reason: mode === "length" ? "max_tokens" : mode === "refusal" ? "refusal" : "end_turn",
    usage: { input_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 5, output_tokens: 7, output_tokens_details: { thinking_tokens: 3 } },
  };
  if (provider === "GOOGLE") return {
    responseId: "private-provider-id", modelVersion: "private-model", debug: keys[provider],
    candidates: [{ index: 0, content: { role: "model", parts: [{ text: "hidden-thinking", thought: true }, { text }] }, finishReason: mode === "length" ? "MAX_TOKENS" : mode === "refusal" ? "SAFETY" : "STOP" }],
    usageMetadata: { promptTokenCount: 12, cachedContentTokenCount: 5, candidatesTokenCount: 4, thoughtsTokenCount: 3, totalTokenCount: 19 },
  };
  return { id: "private-provider-id", model: "private-model", debug: keys[provider],
    choices: [{ index: 0, message: { role: "assistant", content: text, debug: keys[provider] }, finish_reason: mode === "length" ? "length" : mode === "refusal" ? "content_filter" : "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 3 }, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 7 },
  };
}
function corruptUsage(body: Record<string, unknown>, provider: ModelProvider, value: number) {
  const usage = body[provider === "GOOGLE" ? "usageMetadata" : "usage"] as Record<string, unknown>;
  usage[provider === "ANTHROPIC" ? "input_tokens" : provider === "GOOGLE" ? "promptTokenCount" : "prompt_tokens"] = value;
}
const fixture = createServer(async (request, response) => {
  const path = request.url ?? "";
  const provider = providers.find((p) => p === "GOOGLE" ? path.startsWith(paths[p]) : path === paths[p]);
  if (!provider) { redirects++; response.writeHead(404).end(); return; }
  try {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    const model = provider === "GOOGLE" ? decodeURIComponent(path.slice(paths.GOOGLE.length).replace(/:generateContent$/, "")) : String(body.model);
    const mode = model.replace(`private-${seed}-`, "");
    calls.push({ provider, path, headers: request.headers, body, mode });
    if (["auth", "forbidden", "rate", "fail", "invalid", "context", "upstream-missing"].includes(mode)) {
      const statuses: Record<string, number> = { auth: 401, forbidden: 403, rate: 429, fail: 500, invalid: 400, context: 400, "upstream-missing": 404 };
      response.writeHead(statuses[mode], { "Content-Type": "application/json", "X-Secret": keys[provider] }).end(JSON.stringify({ error: {
        message: mode === "context" ? `input token count exceeds maximum context length ${keys[provider]}` : `private error ${keys[provider]}`,
        code: mode === "context" ? "context_length_exceeded" : "private_error", status: "INVALID_ARGUMENT", type: "invalid_request_error",
      } })); return;
    }
    if (mode === "redirect") { response.writeHead(302, { Location: `${fixtureOrigin}/credential-capture` }).end(); return; }
    if (mode === "oversized") { response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "5242880" }).end("{}"); return; }
    if (mode === "invalid-json") { response.writeHead(200, { "Content-Type": "application/json" }).end("{invalid"); return; }
    const result = payload(provider, mode);
    if (mode === "missing-usage") delete result[provider === "GOOGLE" ? "usageMetadata" : "usage"];
    if (mode === "negative-usage") corruptUsage(result, provider, -1);
    if (mode === "fractional-usage") corruptUsage(result, provider, 1.5);
    if (mode === "overflow-usage") corruptUsage(result, provider, 2147483647);
    if (mode === "bad-choice") {
      if (provider === "ANTHROPIC") result.content = [{ type: "tool_use", id: "private-tool", input: { secret: keys[provider] } }];
      else if (provider === "GOOGLE") result.candidates = [];
      else result.choices = [];
    }
    if (mode === "timeout") {
      const timer = setTimeout(() => { if (!response.destroyed) response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result)); }, 1500);
      response.once("close", () => clearTimeout(timer)); return;
    }
    if (mode === "body-timeout") {
      response.writeHead(200, { "Content-Type": "application/json" }); response.write('{"partial":');
      const timer = setTimeout(() => { if (!response.destroyed) response.end("true}"); }, 1500); response.once("close", () => clearTimeout(timer)); return;
    }
    response.writeHead(200, { "Content-Type": "application/json", "X-Secret": keys[provider] }).end(JSON.stringify(result));
  } catch { if (!response.destroyed) response.writeHead(500, { "Content-Type": "application/json" }).end('{"error":{"code":"fixture_error"}}'); }
});

function units(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole + fraction.padEnd(20, "0")); }
function safe(value: unknown) {
  const text = JSON.stringify(value);
  for (const key of Object.values(keys)) assert(!text.includes(key));
  for (const privateValue of [secret, "hidden-thinking", "private-provider-id", "private-signature", "private_error"]) if (privateValue) assert(!text.includes(privateValue));
  for (const field of ["providerModel", "passwordHash", "keyHash", "debug", "providerCost", "messages"]) assert(!text.includes(`"${field}"`));
}
async function check(name: string, run: () => Promise<void>) { activeCheck = name; await run(); passed++; console.log(`PASS ${name}`); }
async function model(provider: ModelProvider, mode: string) {
  const m = await db.model.create({ data: { provider, providerModel: `private-${seed}-${mode}`, slug: `providers-${seed}-${provider.toLowerCase()}-${mode}`, name: "Provider fixture", description: "Local HTTP integration fixture", contextWindow: 4000,
    inputPricePerMillion: "0.12345678", outputPricePerMillion: "0.87654321", markupMultiplier: "1.2", enabled: true } });
  models.push(m); await risk.bindRouting(db, m, fixtureEnv); return m;
}
async function chat(m: Model, extra: Record<string, unknown> = {}) {
  return fetch(origin + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, "X-User-Id": randomUUID() },
    body: JSON.stringify({ model: m.slug, messages: [{ role: "user", content: "Hello" }], max_tokens: 16, ...extra }), signal: AbortSignal.timeout(15000) });
}
async function result(response: Response, status = 200, code?: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-secret"), null);
  const id = response.headers.get("x-request-id"); assert(id); const body = await response.json(); safe(body);
  if (code) { assert.equal(body.error?.code, code); assert.deepEqual(Object.keys(body), ["error"]); }
  const record = await db.apiRequest.findUniqueOrThrow({ where: { requestId: id } });
  assert.equal(record.userId, userId); assert.equal(record.apiKeyId, keyId); assert.equal(record.errorCode, code ?? null);
  if (status === 200) {
    assert.equal(body.model, record.modelSlug); assert.equal(body.id, `chatcmpl-${id}`); assert.equal(body.object, "chat.completion"); assert.equal(body.choices[0].message.role, "assistant");
    assert.deepEqual(Object.keys(body).sort(), ["id", "object", "created", "model", "choices", "usage"].sort());
    assert.deepEqual(body.usage, { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 });
    assert.equal(record.status, "SUCCESS"); assert.equal(record.inputTokens, 12); assert.equal(record.outputTokens, 7); assert.equal(record.totalTokens, 19);
    assert.equal(record.providerCost?.toFixed(20), "0.00000761728383000000"); assert.equal(record.userCost?.toFixed(20), "0.00000914074059600000");
    const entry = await db.walletTransaction.findUniqueOrThrow({ where: { requestId: id } }); assert.equal(entry.amount.toFixed(20), "-0.00000914074059600000");
  } else { assert.equal(record.status, "FAILED"); assert(record.userCost === null || record.userCost.isZero()); assert.equal(await db.walletTransaction.count({ where: { requestId: id } }), 0); }
  assert((await db.wallet.findUniqueOrThrow({ where: { userId } })).reservedBalance.isZero());
  return { body, record };
}
let fixtureEnv: NodeJS.ProcessEnv;
async function main() {
  const env: NodeJS.ProcessEnv = { ...process.env, ...risk.env, DATABASE_URL: url, APP_ORIGIN: origin, NODE_ENV: "production", UPSTREAM_API_KEY: "", GATEWAY_REQUESTS_PER_MINUTE: "1000",
    OPENAI_API_KEY: keys.OPENAI, OPENAI_BASE_URL: configFor("OPENAI").baseUrl, OPENAI_TIMEOUT_MS: "500",
    ANTHROPIC_API_KEY: keys.ANTHROPIC, ANTHROPIC_BASE_URL: configFor("ANTHROPIC").baseUrl, ANTHROPIC_TIMEOUT_MS: "500",
    GEMINI_API_KEY: keys.GOOGLE, GEMINI_BASE_URL: configFor("GOOGLE").baseUrl, GEMINI_TIMEOUT_MS: "500",
    DEEPSEEK_API_KEY: keys.DEEPSEEK, DEEPSEEK_BASE_URL: configFor("DEEPSEEK").baseUrl, DEEPSEEK_TIMEOUT_MS: "500", PAYMENTS_ENABLED: "false" };
  fixtureEnv = env;
  for (const address of [origin, fixtureOrigin]) assert(await fetch(address, { signal: AbortSignal.timeout(300) }).then(() => false).catch(() => true), "Provider test ports must be free.");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" });
  fixture.listen(3135, "127.0.0.1"); await once(fixture, "listening");
  const handle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3134"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); server = handle;
  const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-200000); }; handle.stdout?.on("data", capture); handle.stderr?.on("data", capture);
  let startupError = false; handle.on("error", () => { startupError = true; }); const deadline = Date.now() + 30000;
  while (!await fetch(origin + "/api/auth/session", { signal: AbortSignal.timeout(1000) }).then((r) => r.status === 200).catch(() => false)) { assert(!startupError && handle.exitCode === null && Date.now() < deadline, "Build first; provider test server failed to start."); await new Promise((resolve) => setTimeout(resolve, 100)); }
  const user = await db.user.create({ data: { name: "Provider fixture", email: `providers-${seed}@example.test`, passwordHash: "test-only-unusable-password", wallet: { create: { balance: "10" } } } }); userId = user.id;
  const generated = generateApiKey(); secret = generated.key;
  const key = await db.apiKey.create({ data: { userId, name: "Providers", keyHash: generated.keyHash, keyPrefix: generated.keyPrefix } }); keyId = key.id;
  for (const provider of providers) await check(`${provider} routes a public slug, converts native input, normalizes usage and settles exact CNY`, async () => {
    const m = await model(provider, "success");
    const { body, record } = await result(await chat(m, { messages: [{ role: "developer", content: "Be brief." }, { role: "system", content: "Be helpful." }, { role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }, { role: "user", content: "Continue" }], temperature: 0.7, top_p: 0.9, stop: "END" }));
    assert.equal(record.provider, provider); assert.equal(body.choices[0].message.content, "Hello fixture"); assert.equal(body.choices[0].finish_reason, "stop"); assert((await db.apiKey.findUniqueOrThrow({ where: { id: keyId } })).lastUsedAt);
    const call = calls.at(-1)!; assert.equal(call.provider, provider); assert.equal(call.headers.cookie, undefined); assert.equal(call.headers["x-user-id"], undefined); assert(!JSON.stringify(call.body).includes(m.slug));
    if (provider === "ANTHROPIC") {
      assert.equal(call.headers["x-api-key"], keys[provider]); assert.equal(call.headers["anthropic-version"], "2023-06-01"); assert.equal(call.headers.authorization, undefined);
      assert.equal(call.body.model, m.providerModel); assert.equal(call.body.max_tokens, 16); assert.equal(call.body.system, "Be brief.\n\nBe helpful."); assert.deepEqual(call.body.stop_sequences, ["END"]); assert.equal(call.body.store, undefined);
      assert.deepEqual((call.body.messages as { role: string }[]).map((x) => x.role), ["user", "assistant", "user"]);
    } else if (provider === "GOOGLE") {
      assert.equal(call.headers["x-goog-api-key"], keys[provider]); assert.equal(call.headers.authorization, undefined); assert(!call.path.includes("key=")); assert(call.path.includes(encodeURIComponent(m.providerModel)));
      assert.deepEqual(call.body.systemInstruction, { parts: [{ text: "Be brief.\n\nBe helpful." }] }); assert.deepEqual(call.body.generationConfig, { candidateCount: 1, maxOutputTokens: 16, temperature: 0.7, topP: 0.9, stopSequences: ["END"] });
      assert.deepEqual((call.body.contents as { role: string }[]).map((x) => x.role), ["user", "model", "user"]);
    } else { assert.equal(call.headers.authorization, `Bearer ${keys[provider]}`); assert.equal(call.body.model, m.providerModel); assert.equal(call.body.stream, false);
      if (provider === "OPENAI") { assert.equal(call.body.max_completion_tokens, 16); assert.equal(call.body.max_tokens, undefined); assert.equal(call.body.store, false); }
      else { assert.equal(call.body.max_tokens, 16); assert.equal(call.body.store, undefined); assert.deepEqual(call.body.thinking, { type: "disabled" }); }
    }
  });
  await check("Adapter usage includes caching and thinking exactly once; missing and invalid counts fail closed", async () => {
    for (const provider of providers) {
      assert.deepEqual(adapters[provider].normalizeUsage(payload(provider)), expectedUsage);
      for (const value of [-1, 1.5, 2147483647]) { const body = payload(provider); corruptUsage(body, provider, value); assert.throws(() => adapters[provider].normalizeUsage(body), GatewayError); }
      assert.throws(() => adapters[provider].normalizeUsage({}), GatewayError);
      const huge = payload(provider);
      if (provider === "ANTHROPIC") (huge.usage as Record<string, unknown>).cache_read_input_tokens = -1;
      else if (provider === "GOOGLE") (huge.usageMetadata as Record<string, unknown>).thoughtsTokenCount = -1;
      else (huge.usage as Record<string, unknown>).total_tokens = 20;
      assert.throws(() => adapters[provider].normalizeUsage(huge), GatewayError);
    }
    assert.deepEqual(adapters.GOOGLE.normalizeUsage({ usageMetadata: { promptTokenCount: 1, totalTokenCount: 1 } }), { inputTokens: 1, outputTokens: 0, totalTokens: 1 });
    assert.equal(adapters.GOOGLE.normalizeError(400, { error: { details: [{ reason: "API_KEY_INVALID", metadata: { secret: keys.GOOGLE } }] } }).code, "provider_auth_error");
  });
  for (const provider of providers) await check(`${provider} timeout / 429 / 500 / auth / bad model errors release funds and retain safe logs`, async () => {
    const before = (await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20);
    for (const [mode, status, code] of [["auth", 502, "provider_auth_error"], ["forbidden", 502, "provider_auth_error"], ["rate", 429, "provider_rate_limit"], ["fail", 502, "provider_unavailable"], ["invalid", 400, "invalid_request"], ["context", 400, "context_length_exceeded"], ["upstream-missing", 502, "provider_unavailable"], ["timeout", 504, "provider_timeout"], ["body-timeout", 504, "provider_timeout"]] as const) {
      const m = await model(provider, mode), response = await chat(m); if (mode === "rate") assert.equal(response.headers.get("retry-after"), "60");
      const { record } = await result(response, status, code); assert.equal(record.provider, provider); assert(record.settledAt); assert.equal(record.totalTokens, null); assert(record.userCost?.isZero());
      assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20), before);
    }
    // Failure of this provider never reroutes to another provider or another model.
    assert(calls.slice(-9).every((call) => call.provider === provider));
  });
  await check("Malformed responses and invalid usage release every hold; known usage remains logged without a customer charge", async () => {
    const before = (await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20);
    for (const provider of providers) for (const mode of ["missing-usage", "negative-usage", "fractional-usage", "overflow-usage", "bad-choice", "invalid-json", "oversized", "redirect"]) {
      const m = await model(provider, mode), { record } = await result(await chat(m), 502, "provider_unavailable");
      if (mode === "bad-choice") { assert.equal(record.totalTokens, 19); assert.equal(record.providerCost?.toFixed(20), "0.00000761728383000000"); } else assert.equal(record.totalTokens, null);
    }
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20), before); assert.equal(redirects, 0);
  });
  await check("Finish reasons and visible text are unified without upstream IDs, reasoning or reflected credentials", async () => {
    for (const provider of providers) for (const mode of ["length", "refusal", "reflection", "partial-reflection"]) {
      const m = await model(provider, mode), { body } = await result(await chat(m));
      assert.equal(body.choices[0].finish_reason, mode === "length" ? "length" : mode === "refusal" ? "content_filter" : "stop");
      if (mode === "reflection") assert.equal(body.choices[0].message.content, "Hello [REDACTED]");
      if (mode === "partial-reflection") assert.equal(body.choices[0].message.content, "Hello [REDACTED]x");
    }
    const blocked = adapters.GOOGLE.normalizeResponse({ promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 1, totalTokenCount: 1 } });
    assert.equal(blocked.choices[0].finish_reason, "content_filter"); assert.equal(blocked.choices[0].message.content, null);
  });
  await check("Usage exceeding the reserved output budget never debits any provider's customer wallet", async () => {
    const before = (await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20);
    for (const provider of providers) {
      const m = models.find((m) => m.provider === provider && m.providerModel.endsWith("success"))!;
      const { record } = await result(await chat(m, { max_tokens: 5 }), 500, "provider_usage_exceeded");
      assert.equal(record.totalTokens, 19); assert.equal(record.providerCost?.toFixed(20), "0.00000761728383000000");
    }
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20), before);
  });
  await check("Native adapters reject unsupported conversations and sampling instead of silently changing the prompt", async () => {
    const before = calls.length;
    for (const provider of ["ANTHROPIC", "GOOGLE"] as const) {
      const m = models.find((m) => m.provider === provider && m.providerModel.endsWith("success"))!;
      for (const messages of [[{ role: "system", content: "Only instructions" }], [{ role: "user", content: "Hi" }, { role: "system", content: "Late instruction" }]]) await result(await chat(m, { messages }), 400, "invalid_request");
      if (provider === "ANTHROPIC") await result(await chat(m, { temperature: 1.1 }), 400, "invalid_request");
    }
    assert.equal(calls.length, before);
  });
  await check("Streaming adapters reject non-SSE upstream responses without billing or leaking their bodies", async () => {
    const before = calls.length, wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
    for (const provider of providers) {
      const m = models.find((m) => m.provider === provider && m.providerModel.endsWith("success"))!;
      await result(await chat(m, { stream: true }), 502, "streaming_interrupted");
      const input: ChatCompletionInput = { model: m.slug, messages: [{ role: "user", content: "Hello" }] };
      const stream = await adapters[provider].streamChatCompletion(input, { providerModel: m.providerModel, requestId: randomUUID(), signal: new AbortController().signal });
      await assert.rejects(stream[Symbol.asyncIterator]().next(), (e) => e instanceof GatewayError && e.code === "streaming_interrupted");
    }
    assert.equal(calls.length - before, 8); assert.equal((await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.toFixed(20), wallet.balance.toFixed(20));
  });
  await check("Provider credentials are isolated, absent configuration fails closed, and unsafe destinations are rejected", async () => {
    const constructors = [OpenAIProvider, AnthropicProvider, GeminiProvider, DeepSeekProvider];
    for (const Provider of constructors) {
      for (const baseUrl of ["http://unsafe.example/v1", "https://user:password@unsafe.example/v1", "https://unsafe.example/v1?key=injected", "https://unsafe.example/v1#fragment", "not-a-url"]) assert.throws(() => new Provider({ apiKey: "fixture-only", baseUrl }), (e) => e instanceof GatewayError && e.code === "provider_not_configured");
      assert.throws(() => new Provider({ apiKey: "", baseUrl: fixtureOrigin }), GatewayError);
      assert.throws(() => new Provider({ apiKey: "invalid\r\nheader", baseUrl: fixtureOrigin }), GatewayError);
    }
    // Missing native credentials cannot borrow the OpenAI key or vice versa.
    const names = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"];
    const previous = names.map((name) => process.env[name]);
    try { names.forEach((name) => { process.env[name] = ""; }); process.env.UPSTREAM_API_KEY = "unused-legacy-fixture";
      for (const Provider of constructors) assert.throws(() => new Provider(), (e) => e instanceof GatewayError && e.code === "provider_not_configured");
    } finally { names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); delete process.env.UPSTREAM_API_KEY; }
  });
  await check("Missing and disabled public models never dispatch upstream or touch funds", async () => {
    const m = await model("GOOGLE", "disabled"); await db.model.update({ where: { id: m.id }, data: { enabled: false } });
    const before = calls.length;
    await result(await chat(m), 404, "model_not_found"); await result(await chat({ ...m, slug: `missing-${seed}` }), 404, "model_not_found");
    assert.equal(calls.length, before);
  });
  await check("Cancelling a provider request aborts transport; other providers remain independent", async () => {
    for (const provider of providers) {
      const controller = new AbortController(), count = calls.length;
      const pending = adapters[provider].chatCompletion({ model: "public-model", messages: [{ role: "user", content: "Hello" }] }, { requestId: randomUUID(), providerModel: `private-${seed}-timeout`, signal: controller.signal });
      const deadline = Date.now() + 2000; while (calls.length === count) { assert(Date.now() < deadline); await new Promise((resolve) => setTimeout(resolve, 10)); }
      controller.abort(); await assert.rejects(pending, (e) => e instanceof GatewayError && e.code === "request_cancelled");
      const healthy = await adapters[provider].chatCompletion({ model: "public-model", messages: [{ role: "user", content: "Hello" }] }, { requestId: randomUUID(), providerModel: `private-${seed}-success`, signal: new AbortController().signal });
      assert.deepEqual(healthy.usage, expectedUsage); safe(healthy);
    }
  });
  await check("All provider charges reconcile to one ledger, with no negative balance, leaked secrets or stored prompt/response", async () => {
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } }), ledger = await db.walletTransaction.findMany({ where: { walletId: wallet.id } }), records = await db.apiRequest.findMany({ where: { userId } });
    assert.equal(units(wallet.balance.toFixed(20)), units("10") + ledger.reduce((sum, row) => sum + units(row.amount.toFixed(20)), BigInt(0))); assert(!wallet.balance.isNegative()); assert(wallet.reservedBalance.isZero());
    assert.equal(ledger.length, records.filter((r) => r.status === "SUCCESS").length); assert(!records.some((r) => r.status === "PENDING"));
    const stored = JSON.stringify(records);
    for (const value of [...Object.values(keys), secret, "Hello fixture", "hidden-thinking"]) assert(!stored.includes(value) && !output.includes(value));
  });
  console.log(`Multi-provider integration checks: ${passed} passed (four local native HTTP fixtures; no live upstream calls).`);
}
async function run() {
  try { await main(); } catch (error) { console.error(`FAIL ${activeCheck}. No secrets or raw upstream bodies were printed.`); if (error instanceof assert.AssertionError) console.error(`Assertion at ${error.stack?.split("\n").find((line) => line.includes("test-providers.ts"))?.trim() ?? "integration check"}`); process.exitCode = 1; }
  finally {
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    if (fixture.listening) { fixture.closeAllConnections(); await new Promise<void>((resolve) => fixture.close(() => resolve())); }
    if (userId) await db.user.deleteMany({ where: { id: userId, email: `providers-${seed}@example.test` } }).catch(() => { console.error("Provider user cleanup failed."); process.exitCode = 1; });
    await db.model.deleteMany({ where: { slug: { startsWith: `providers-${seed}-` } } }).catch(() => { console.error("Provider model cleanup failed."); process.exitCode = 1; });
    await risk.cleanup(); await risk.cleanupRouting(db); await db.$disconnect();
  }
}
void run().catch(() => { console.error("Provider cleanup failed."); process.exitCode = 1; });
