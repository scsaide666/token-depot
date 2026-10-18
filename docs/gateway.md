# Chat completion gateway

`POST /v1/chat/completions` accepts a platform API key and routes the public model slug through database metadata to OpenAI, Anthropic, Google Gemini or DeepSeek. All four adapters return the same text chat response and TokenUsage. The existing wallet reservation, Decimal settlement, request history and Redis limits remain shared; see [billing](billing.md) and [risk protection](api-risk.md).

## Configuration

The current rollout enables DeepSeek only. OpenAI, Anthropic and Gemini adapters remain available for a later rollout; their local secrets are blank and their catalog entries are disabled. See [DeepSeek setup](deepseek.md) for the verified model, fixed CNY pricing policy and local setup command.

Configure each provider privately on the server, in ignored `.env.local` or a secret manager:

| Database provider | Secret | Base URL (default) | Timeout |
| --- | --- | --- | --- |
| OPENAI | OPENAI_API_KEY | OPENAI_BASE_URL: https://api.openai.com/v1 | OPENAI_TIMEOUT_MS |
| ANTHROPIC | ANTHROPIC_API_KEY | ANTHROPIC_BASE_URL: https://api.anthropic.com/v1 | ANTHROPIC_TIMEOUT_MS |
| GOOGLE | GEMINI_API_KEY | GEMINI_BASE_URL: https://generativelanguage.googleapis.com/v1beta | GEMINI_TIMEOUT_MS |
| DEEPSEEK | DEEPSEEK_API_KEY | DEEPSEEK_BASE_URL: https://api.deepseek.com | DEEPSEEK_TIMEOUT_MS |

Timeouts default to 90,000ms and accept 100–120,000ms (short values support integration fixtures). Explicit channel timeouts override provider defaults, within one 120-second request deadline. Both headers and body reads share that deadline and the caller's abort signal. HTTPS is required outside loopback fixtures; URL credentials, query strings, fragments and redirects are rejected. Bounded retries can use explicitly compatible channels after a confirmed pre-execution rejection. Uncertain execution permits only a verified idempotent replay on its original channel, never cross-provider/model fallback. Only the selected channel's credential is sent, without customer cookies or identity headers. See [channel routing and health](provider-routing-design.md).

The old single-upstream `UPSTREAM_*` configuration is replaced by `OPENAI_*`. Existing private OpenAI settings in this workspace were renamed without printing their values. Other deployments must rename the variables and restart; the router does not borrow credentials from another provider. Missing provider configuration returns 503 before funds are reserved and does not affect a configured provider.

Admin models use `provider` and `providerModel`; ordinary clients send only `model.slug`. Configure CNY provider rate baselines, context limits and platform markup in Admin. The explicit DeepSeek setup seeds the verified deepseek-flash route; it does not invent model IDs or automatically overwrite existing administrator prices.

## Request and response

```sh
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_ENABLED_MODEL_SLUG","messages":[{"role":"user","content":"Hello"}]}'
```

Supported fields: `model`, string-content `messages` with developer/system/user/assistant roles, optional `temperature`, `top_p`, `max_tokens` or `max_completion_tokens`, `stop`, `n: 1` and `stream: true/false`. `stream_options.include_usage` returns the final usage chunk; stream options require `stream: true`. Token limit aliases are mutually exclusive. Tools, media, multiple choices and unknown routing/identity fields are rejected. Provider-specific sampling restrictions are preserved and returned as a safe invalid_request rather than silently clamping parameters.

Request limits remain 256KiB / 10 seconds, 64 messages, 32,768 characters per message, 131,072 total input characters and 32,768 output tokens. Upstream success responses are bounded to 4MiB and error classification to 32KiB. If the caller omits its output budget, GATEWAY_DEFAULT_MAX_OUTPUT_TOKENS defaults to 1024, reduced to fit remaining context. The exact budget reserved is transmitted to the provider.

Responses contain only a gateway-generated `id`, `object: "chat.completion"`, `created`, public `model`, `choices` with assistant message / finish_reason, and OpenAI-compatible `usage`: prompt_tokens / completion_tokens / total_tokens. Upstream request IDs, model IDs, headers, debug metadata and thinking text are excluded. Reflected provider credentials are redacted from visible output.

Every response includes X-Request-Id, Cache-Control: no-store and X-Content-Type-Options: nosniff.

## Adapter boundaries

`lib/ai/providers/` contains openai.ts, anthropic.ts, gemini.ts and deepseek.ts. The shared JsonProvider handles bounded HTTP, credential isolation, aborts, deadlines and safe errors. Adapters own request conversion, response projection and usage normalization. The router creates only the adapter selected by the enabled database model; neither Route nor billing contains native-provider request logic.

The unified interface contains chatCompletion(), streamChatCompletion(), normalizeResponse(), normalizeUsage() and normalizeError(). All four adapters support native streaming with a bounded SSE parser and a single public Chat Completions chunk format. Complete streams settle before the successful finish/usage/DONE sequence. Partial delivery is never replayed. Missing final usage or interruption releases the hold, records FAILED and retains unknown costs for reconciliation. See [streaming and SDK compatibility](streaming.md) and the examples directory.

OpenAI sends its native Chat Completions format with store:false and maps either token-limit alias to max_completion_tokens. DeepSeek uses its separate key, developer-to-system conversion, max_tokens and the existing non-thinking text mode. Anthropic extracts leading developer/system instructions into its system field and maps messages, max_tokens and stop_sequences. Gemini converts assistant to model, sends systemInstruction / contents / generationConfig and puts its key in x-goog-api-key, never the URL. Gemini providerModel may be a bare ID or start with models/; the remaining ID is URL encoded.

Native adapters require at least one conversational message. They reject instructions placed after conversation messages so that conversion cannot silently reorder their meaning. Anthropic rejects temperature above 1; further model-specific restrictions are handled through normalized upstream errors.

## Usage and settlement

The internal contract is `{ inputTokens, outputTokens, totalTokens }`, with nonnegative integer counts up to 2,147,483,647 and total = input + output.

- OpenAI / DeepSeek: prompt_tokens and completion_tokens already include their cached/reasoning components; these details are not added again.
- Anthropic: input_tokens + cache_creation_input_tokens + cache_read_input_tokens form the complete input. output_tokens includes thinking.
- Gemini: promptTokenCount already includes cached input. Output = candidatesTokenCount + thoughtsTokenCount. The result must reconcile to totalTokenCount. An omitted candidate count is accepted only when the authoritative totals prove it contributes zero.

Counts are never guessed from local text, nor replaced with zero when usage is missing, negative, fractional, overflowing or inconsistent. A valid usage block from an invalid text response is retained on the failed record and can record known provider cost, with no customer debit. Refusals and length-limited responses use standardized content_filter / length reasons and bill their actual validated usage.

Wallet reservation, immutable model price snapshot, unique request ID and row locks remain unchanged for every provider. A successful response is returned only after settlement, one USAGE ledger entry, final ApiRequest and Last Used commit. Provider failure, cancellation, timeout, invalid response or usage exceeding the reserved output/context releases the hold and does not debit the user. Last Used is touched after an admitted adapter attempt, including failed attempts; pre-admission rejections do not touch it.

Settlement is idempotent by request ID. Separate HTTP requests receive new IDs. If a database outage prevents settlement confirmation after dispatch, return billing_unavailable with the durable Pending hold retained for internal retry / expiry recovery; do not report successful settlement or retry the upstream.

ApiRequest stores identity references, provider, counts, costs, status, latency, safe error code and reservation/price snapshots. It stores no complete prompt, response, credentials or raw upstream error. Unknown usage/cost remains NULL.

## Errors

```json
{"error":{"message":"Invalid API key","type":"authentication_error","code":"invalid_api_key"}}
```

| Status | Code | Meaning |
| --- | --- | --- |
| 401 | invalid_api_key | Missing / invalid / revoked / expired platform key |
| 403 | account_suspended | Key owner is not ACTIVE |
| 402 | insufficient_balance | Available wallet funds cannot cover the hold |
| 404 | model_not_found | Public model is missing or disabled |
| 400 / 413 / 415 | invalid_request | Invalid parameters / oversized body / wrong content type |
| 400 | context_length_exceeded | Local budget or native upstream context limit |
| 502 | streaming_interrupted / usage_missing | Incomplete stream or unconfirmed final usage; no estimated customer debit |
| 429 | rate_limit_exceeded | Platform Redis limit |
| 429 | provider_rate_limit | Upstream limit; includes Retry-After |
| 502 | provider_auth_error | Upstream credential / permission failure, including Google's 400 API_KEY_INVALID |
| 502 | provider_unavailable | Upstream 404/5xx, network failure, malformed response or invalid usage |
| 504 | provider_timeout | Header/body deadline; abort and release hold |
| 499 | request_cancelled | Caller abort; release hold |
| 503 | provider_not_configured | Selected provider configuration is missing / invalid |
| 503 | risk_unavailable | Redis unavailable; fail closed before hold |
| 500 | provider_usage_exceeded / billing_limit_exceeded | Usage cannot settle safely within budget/funds |
| 500 | reservation_expired | A recovered reservation cannot charge later |
| 503 | wallet_unavailable / billing_unavailable | Wallet / settlement could not be confirmed |
| 500 | gateway_error | Internal gateway failure |

Raw upstream messages are inspected only for bounded classification and are never echoed or logged. Provider faults continue to feed safe abnormal-behavior counters. There is no automatic suspension; fallback follows the compatible-channel and uncertain-execution guards.

## Verification

Build before production-server integration tests:

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

test:providers uses only local aihub_auth_test PostgreSQL, Redis DB15, production server port3134 and four native HTTP fixtures on port3135. All keys are synthetic and all fixture base URLs are loopback. It covers each protocol's headers / roles / system / sampling / token limits, cached and thinking usage, finish reasons, public IDs, exact Decimal charges, failures, both header/body timeouts, provider isolation, malformed responses, known failed usage, redirects, output-budget overrun, non-SSE streaming negotiation failure, caller cancellation and ledger reconciliation. Its fixtures are removed on exit. test:streaming adds native SSE and real official SDK/curl checks on ports3150–3152.

Existing test:gateway / test:billing / test:risk suites cover authentication, Decimal precision, request concurrency, idempotent settlement and fail-closed limits; all remain in npm test. Fixture success verifies implementation contracts, not a real account's credentials, credits or model access.

Live smoke tests remain separate opt-in commands: npm run smoke:gateway (OpenAI) and npm run smoke:deepseek. Each makes one request with at most eight output tokens against a temporary test wallet/model and checks actual usage, ledger and hold release. They are excluded from npm test and never alter development balances.

## Protocol references

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) and [cache usage](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Gemini generateContent / UsageMetadata](https://ai.google.dev/api/generate-content)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
