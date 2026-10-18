export const docsSections = [
  { id: "getting-started", label: "Quick Start", topics: [{ id: "base-url", label: "Base URL" }, { id: "quick-start", label: "Quick start" }] },
  { id: "authentication", label: "Authentication", topics: [{ id: "bearer-token", label: "Bearer token" }] },
  { id: "api-keys", label: "API Keys", topics: [{ id: "create-key", label: "Create a key" }, { id: "key-security", label: "Key security" }] },
  { id: "models", label: "Models", topics: [{ id: "list-models", label: "List models" }, { id: "model-identifiers", label: "Model identifiers" }] },
  { id: "chat-completions", label: "Chat Completions", topics: [{ id: "request-example", label: "Request example" }, { id: "response-example", label: "Response example" }, { id: "parameters", label: "Parameters" }] },
  { id: "streaming", label: "Streaming", topics: [{ id: "stream-example", label: "Streaming examples" }, { id: "stream-format", label: "Event format" }, { id: "cancellation", label: "Cancellation" }] },
  { id: "errors", label: "Error Codes", topics: [{ id: "error-response", label: "Error response" }, { id: "status-codes", label: "Status codes" }] },
  { id: "rate-limits", label: "Rate Limits", topics: [{ id: "handling-limits", label: "Request limits" }, { id: "retry-behavior", label: "Retry behavior" }] },
  { id: "billing", label: "Usage & Billing", topics: [{ id: "token-pricing", label: "Token pricing" }, { id: "balance-settlement", label: "Balance & settlement" }] },
] as const;
export type DocsSectionId = (typeof docsSections)[number]["id"];
export type ExampleLanguage = "curl" | "javascript" | "python";
export type LanguageExamples = Record<ExampleLanguage, { label: string; code: string }>;

// Used by the documentation and executable SDK contract tests.
export function buildRequestExamples(baseUrl: string, model: string, stream = false): LanguageExamples {
  const body = { model, messages: [{ role: "user", content: "Hello, Token Depot." }], max_tokens: 256, stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}) };
  return {
    curl: { label: "cURL", code: `curl${stream ? " -N" : ""} '${baseUrl}/chat/completions' \\
  -H "Authorization: Bearer $AIHUB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body, null, 2)}'` },
    javascript: { label: "JavaScript / TS", code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.AIHUB_API_KEY,
  baseURL: ${JSON.stringify(baseUrl)},
  maxRetries: 0,
  timeout: 180_000
});

const ${stream ? "stream" : "completion"} = await client.chat.completions.create(${JSON.stringify(body, null, 2)});

${stream ? `for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? "");
  if (chunk.usage) console.log("\\nUsage:", chunk.usage);
}` : `console.log(completion.choices[0].message.content);
console.log("Usage:", completion.usage);`}` },
    python: { label: "Python", code: `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["AIHUB_API_KEY"],
    base_url=${JSON.stringify(baseUrl)},
    max_retries=0,
    timeout=180.0,
)

${stream ? "stream" : "completion"} = client.chat.completions.create(
    model=${JSON.stringify(model)},
    messages=[{"role": "user", "content": "Hello, Token Depot."}],
    max_tokens=256,
    stream=${stream ? "True" : "False"},${stream ? '\n    stream_options={"include_usage": True},' : ""}
)

${stream ? `for chunk in stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="", flush=True)
    if chunk.usage:
        print("\\nUsage:", chunk.usage)` : `print(completion.choices[0].message.content)
print("Usage:", completion.usage)`}` },
  };
}

// This project's model catalog is /api/models, not the SDK's /v1/models.
export function buildModelsExamples(baseUrl: string): LanguageExamples {
  const url = `${new URL(baseUrl).origin}/api/models`;
  return {
    curl: { label: "cURL", code: `curl '${url}'` },
    javascript: { label: "JavaScript / TS", code: `const response = await fetch(${JSON.stringify(url)});\nif (!response.ok) throw new Error("Model catalog unavailable");\nconst { models } = await response.json();\nconsole.log(models);` },
    python: { label: "Python", code: `import json\nfrom urllib.request import urlopen\n\nwith urlopen(${JSON.stringify(url)}, timeout=30) as response:\n    catalog = json.load(response)\nprint(catalog["models"])` },
  };
}

export const errorResponseExample = JSON.stringify({ error: { message: "Invalid API key", type: "authentication_error", code: "invalid_api_key" } }, null, 2);
export const requestParameters = [
  { name: "model", type: "string", required: true, description: "An enabled platform model slug from /api/models. Do not send an upstream model ID." },
  { name: "messages", type: "array", required: true, description: "1–64 text messages. Each has role (system, developer, user or assistant) and string content. Images, tools and function calls are not supported by this endpoint." },
  { name: "max_tokens", type: "integer", required: false, description: "1–32,768 output tokens, further bounded by model context. When omitted, the deployment default is bounded by remaining model context. max_completion_tokens is an alias; send only one of these fields." },
  { name: "temperature", type: "number", required: false, description: "Optional sampling control, only for models that support it. Gateway range: 0–2; Anthropic range: 0–1. Omit it for reasoning models. Playground shows only supported controls." },
  { name: "stream", type: "boolean", required: false, description: "Default false returns JSON. true returns OpenAI-compatible server-sent events." },
  { name: "stream_options", type: "object", required: false, description: "With stream: true, include_usage: true adds a final usage chunk with an empty choices array. Billing uses confirmed usage even if this option is omitted." },
  { name: "top_p / stop / n", type: "optional", required: false, description: "top_p: 0–1; stop: one string or 1–4 strings, each up to 200 characters. Model support varies. n must be 1. Unknown fields are rejected." },
] as const;
export const errorStatuses = [
  { status: "400 / 413", label: "invalid_request", description: "Check parameters, model capabilities and request size. context_length_exceeded means the conversation does not fit the model." },
  { status: "401", label: "invalid_api_key", description: "The platform key is invalid, revoked or expired." },
  { status: "402", label: "insufficient_balance", description: "Available balance is too small for the reservation. Review Billing before retrying." },
  { status: "403", label: "account_suspended", description: "This account is suspended." },
  { status: "404", label: "model_not_found", description: "The platform model slug is unknown or disabled." },
  { status: "429", label: "rate_limit_exceeded / provider_rate_limit", description: "Requests, tokens, concurrency or upstream capacity exceeded a limit. Respect Retry-After when provided." },
  { status: "502 / 503", label: "provider_unavailable / provider_auth_error / provider_not_configured", description: "The provider could not serve the request. Internal credentials and upstream errors are never returned." },
  { status: "504", label: "provider_timeout", description: "The provider timed out. Execution may be uncertain; do not blindly resend." },
  { status: "502", label: "streaming_interrupted / usage_missing", description: "The stream or its final token usage could not be confirmed. Partial output may already have arrived." },
  { status: "500 / 503", label: "billing_unavailable / gateway_error / risk_unavailable", description: "Settlement or request protection could not be confirmed. Check Usage before repeating the request." },
] as const;
