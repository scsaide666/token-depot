# Wallet reservation and token billing

`POST /v1/chat/completions` checks and reserves the authenticated key owner's CNY wallet before calling an upstream. New users start with zero balance. Payment orders and verified recharge settlement are documented separately in [payments.md](payments.md); no client-accessible direct balance adjustment endpoint exists.

## Money and prices

Wallet amounts, request costs and ledger amounts use PostgreSQL `numeric(50,20)` and Prisma Decimal. Billing arithmetic uses an isolated Decimal constructor with 80 significant digits. Monetary values never pass through JavaScript Number or Float; database writes and account DTOs use decimal strings. Token counts remain bounded integers.

The smallest supported CNY provider price (`0.00000001` per million) and markup (`0.000001`) produce a one-token charge of `0.00000000000000000001`. Twenty fractional places preserve that charge without rounding it to zero. Model cost/markup columns use `numeric(22,8)` / `numeric(12,6)`. The one-time USD to CNY migration multiplied existing wallet amounts, request snapshots, fees and ledger entries by seven, without changing token counts or markup. Database constraints reject negative/non-finite amounts, holds greater than balance, inconsistent request costs and unbalanced ledger rows.

```text
availableBalance = balance - reservedBalance
providerCost = (inputTokens * inputPricePerMillion
              + outputTokens * outputPricePerMillion) / 1000000
userCost = providerCost * markupMultiplier
```

Input/output prices above are provider costs. Public model pages continue to expose selling prices only. Request price snapshots and provider costs stay server-side. Displaying a balance to two decimal places does not change stored precision; the displayed available balance subtracts current holds.

## Admission and reservation

After authentication, model validation and rate limiting, the gateway estimates input tokens from the UTF-8 byte lengths of text and roles, plus per-message and fixed framing allowances. This is a conservative text estimate, not the provider's tokenizer and never a replacement for real usage in final billing.

The output budget comes from `max_completion_tokens` or `max_tokens`. When neither is supplied, `GATEWAY_DEFAULT_MAX_OUTPUT_TOKENS` defaults to `1024`, bounded by remaining model context. Both limit fields cannot be supplied together. Excessive budgets return `400 context_length_exceeded`. The same output limit used for the hold is always sent upstream, including the default. DeepSeek receives its compatible `max_tokens` field.

The estimated input cost and maximum output cost are multiplied by markup to obtain `reservedAmount`. Inside one database transaction:

1. Lock the owner's Wallet with `SELECT ... FOR UPDATE`.
2. Release that owner's abandoned, expired reservations.
3. Reject an existing `requestId`, then check `balance - reservedBalance` under the lock.
4. Increase `reservedBalance` and create the `PENDING` ApiRequest together.

Insufficient funds return `402` with `error.type = billing_error` and `error.code = insufficient_balance`. No upstream call, ledger entry or Last Used update occurs. The rejected request still has a metadata-only failed history record. A missing wallet returns a safe server error. No wallet lock is held during the upstream network call.

The Pending record snapshots the slug, provider prices, markup, context limit, estimated input count, output budget and reservation expiry. Editing or disabling a model after dispatch does not reprice its in-flight requests. `reservedAmount` remains in history after release as the original estimate.

## Success and failure

Settlement locks the owner's Wallet, then the referenced API key (if it still exists), then the owned ApiRequest. This ordering permits key deletion and its history FK update without a cycle against Last Used updates. The wallet lock serializes all billing mutations for an account across application processes.

For a successful completion, a single transaction:

1. Checks that the request is still Pending and validates trustworthy integer usage.
2. Calculates `providerCost` and `userCost` from the saved price snapshot.
3. Releases this request's hold and deducts the exact charge from `balance`.
4. Creates one `WalletTransaction` of type `USAGE`, with a negative `amount`, `balanceBefore`, `balanceAfter`, unique `requestId`, model slug and description.
5. Updates Last Used and the request's usage, costs, `SUCCESS` status and `settledAt`.

A zero-cost model creates a zero-amount usage entry and does not require a positive wallet balance. The transaction guarantees `balanceAfter = balanceBefore + amount` and preserves other requests' holds.

Provider errors, timeouts and invalid responses release the request's hold and become `FAILED`, with `userCost = 0`, `settledAt` and no usage debit/ledger entry. Trusted usage, if available from an otherwise invalid completion, is retained with its calculated provider cost. Unknown usage and provider cost remain NULL; an estimate is never reported as actual token usage.

Provider framing can differ from the conservative input estimate. If the true fee exceeds this request's hold, settlement can use only additional **unreserved** funds under the same wallet lock. If those funds are insufficient, it releases this request's hold, records `billing_limit_exceeded`, returns a safe 500 and does not debit the user. Output exceeding the transmitted limit, or usage exceeding model context, similarly fails with `provider_usage_exceeded`. Another request's reserved funds are never consumed, and the wallet cannot become negative.

## Idempotency and interrupted requests

`ApiRequest.requestId` and `WalletTransaction.requestId` are unique. Repeating reservation with the same ID cannot create a second hold or dispatch. Repeating success/failure settlement returns the original terminal result without changing charges, usage or reservations, even when retry parameters differ. Settlement helpers are internal; there is no client API accepting a user ID for settlement.

The HTTP gateway assigns a new ID to each incoming HTTP request. It does not cache completions or deduplicate separate HTTP retries. A client retry is a new invocation and can be billed separately. `X-Request-Id` identifies the original invocation for reconciliation; it is not a client-supplied idempotency key.

If a settlement write fails, its whole transaction rolls back and the gateway returns `503 billing_unavailable`. The Pending row and hold remain durable for internal settlement retry or recovery. No automatic upstream retry is made, because tokens might already have been consumed. A failed ledger write cannot partially debit a wallet.

Reservations expire after ten minutes, longer than the supported provider timeout. A subsequent reservation lazily releases that user's expired Pending holds; `recoverExpiredReservations(userId)` also supports a trusted internal recovery process. Recovery marks them `FAILED / reservation_expired`, releases the hold once and does not charge. A late callback cannot revive a recovered request. No background scheduler is introduced in this stage, so an inactive user's abandoned hold remains until recovery or their next request.

Historical pre-billing requests remain unbilled with NULL price/cost snapshots; migrations do not retrospectively charge them. New Pending records must have complete snapshots. Prompt text, completion contents, credentials and raw provider errors are not stored.

## Verification

```sh
npm run db:migrate
npm run lint
npm run typecheck
npm run build
npm test
```

`test:billing` requires the isolated local `aihub_auth_test` database. It starts two production Next servers (3108/3109) and a synthetic upstream (3110), overrides upstream credentials with random test-only values and cleans up its own data. Its trusted test fixtures fund only wallets in the test database; this is not a payment or top-up feature and never changes a development user's funds.

The suite verifies sufficient/insufficient balances, one input/output token, one million tokens, the smallest supported charge, large prices, immutable price snapshots, failed-provider release, duplicate/concurrent settlements, rollback and retry, expiry recovery, owner isolation, in-flight key deletion and database invariants. For 10 and 100 concurrent HTTP requests across two app processes, it holds accepted upstream replies open: with ¥1 available and a ¥0.50 reservation per request, exactly two are admitted and all others receive 402. It then verifies exact charges and released holds.

`test:gateway` also reconciles successful request costs against the usage ledger. Live provider smoke tests remain separate and opt-in; they now verify billing against a temporary funded wallet in the isolated test database and consume real provider credits. The billing suite itself never calls a real provider.
