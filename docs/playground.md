# API documentation and Playground

`/docs` uses the configured public `APP_ORIGIN`, enabled model slugs, current
limits and executable Python / JavaScript / curl examples. `/api/models` is the
public catalog; `/v1/models` is not implemented. Only text Chat Completions is
supported. SDK retries are disabled in the examples because uncertain execution
must not be automatically resent.

## Session entry point

`POST /api/playground` requires an active Session and same-origin JSON. Accepts
only `submissionId` (UUID), `model`, text `messages`, `max_tokens`, and supported
`temperature`. No browser-supplied user ID, upstream model or price is accepted.
It forces streaming with final usage and enters the shared Gateway. The public
`/v1/chat/completions` route still requires a platform API key.

A database unique constraint claims `(userId, submissionId)` before dispatch.
Repeated submissions return 409 without another upstream call, hold or charge.
The server generates the root request ID. No automatic browser retry occurs.
If Stop or a connection loss happens before response headers arrive, the browser
recovers the owned run with `GET /api/playground/submissions/:submissionId`, without
replaying a generation or creating a second charge.
Playground uses the same user / IP / endpoint RPM and TPM dimensions as the API,
plus one stable per-user Playground key scope and concurrency lease. A separate
entry limit protects validation and duplicate traffic. No API key is generated.

## Parameters and privacy

Only enabled models with a configured enabled channel are offered. Sampling is
omitted for reasoning IDs and conservatively for OpenAI models. Anthropic allows
0–1; other supported sampling models allow 0–2. Playground output is capped at
4,096 tokens or the model context budget, whichever is smaller. The server checks
the same policy; the Gateway further bounds input and output against context.

Conversation text lives only in tab memory and is not persisted. Request logs and
submission records contain metadata, not prompts or responses. Markdown uses a
React AST renderer with no raw HTML. Remote images and non-HTTP(S) links are
disabled. Provider secrets, costs, private model IDs and routing metadata are
never included in the model projection, statistics or browser bundle.

## Completion and cancellation

The upstream AbortSignal and existing stream cancellation / settlement pipeline
remain shared with the API. Stop aborts the browser stream; closing the page
cancels generation and statistics polling. No incomplete stream is silently
replayed or spliced. A committed terminal ledger cannot be changed by a late
disconnect. Unknown upstream usage stays pending reconciliation and produces no
estimated user charge.

`GET /api/playground/runs/:id` checks Session ownership for both submission and
request. Its public projection contains recorded tokens, status, latency, Decimal
user cost in CNY, and available balance. Statistics polling is bounded to 15
seconds after the stream ends; no missing usage is rendered as invented tokens.
The same ApiRequest and WalletTransaction feed Dashboard, Usage, Billing and
Admin. Session-origin requests appear as Playground rather than a deleted key.

## Verification

`npm run test:playground` uses isolated PostgreSQL / Redis and native mock
providers, without enabling American providers or using their real credentials.
It covers Session ownership, CSRF, real Gateway stream / settlement, duplicate
submissions, insufficient balance, cancellation, missing usage, shared rate limits,
concurrency, parameter capabilities and executable documentation examples.
`npm test` also runs the existing authentication, API key, billing, payment,
analytics, risk, Admin, provider, routing and SDK streaming suites.

`npm run smoke:playground` makes one tiny real DeepSeek streaming request using
the existing server configuration. It requires the isolated local test database
and Redis database 15, creates a disposable account and model, and verifies the
owned statistics, exact single debit and released hold before removing fixtures.
It never prints credentials or raw upstream content and is separate from `npm test`.
