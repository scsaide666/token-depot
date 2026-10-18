# Step 28: channel routing

Keep the existing public API, model slugs, Decimal sales snapshots, wallet locks, Redis limits and Apple UI components. Only /admin/providers and its navigation entry are added.

Persist ProviderChannel, explicit compatible ModelChannel bindings and one ProviderAttempt per dispatch. No secret values, prompt or response are stored. Channels reference provider-scoped server environment variables. A binding must use the model's same provider, exact upstream model identifier and sufficient context. Changing canonical model metadata invalidates incompatible bindings.

PostgreSQL row locks serialize channel RPM/TPM/concurrency admission and circuit transitions across processes. CLOSED -> OPEN after consecutive provider faults; cooldown -> HALF_OPEN with one expiring probe lease; only the matching circuit generation can restore CLOSED. Stale successes cannot reopen a newly tripped circuit. Routing prefers healthy channels, manual preference, lower priority, latency/cost rank, then weighted selection among comparable channels.

At most two retries / three attempts fit one 120-second overall deadline. Confirmed pre-execution rejection can switch compatible channels with bounded jitter/backoff. Uncertain timeout/network/5xx is never blindly replayed. A channel explicitly verified to support Idempotency-Key may retry only that same channel/key; uncertain execution never switches channels, even if a later replay is rejected. A rejected replay's zero-token usage does not confirm the cost of its earlier uncertain execution. Once output has started no retry is allowed. Step29 adds [native streaming](streaming.md), using this same admission/retry policy before the first public event and forbidding replay afterwards.

The customer holds and settles only one requestId. Sales prices remain the original model snapshot; channel costs have independent immutable attempt snapshots. Costs aggregate by execution group so idempotent replays never double-count. Missing usage remains NULL and PENDING_RECONCILIATION, never zero. Known usage on an invalid response is preserved. One immutable USAGE ledger entry charges the successful result only.

Late confirmed usage may resolve the cost of an expired attempt and its already settled failed root request. It never changes that failure, resets the newer circuit, revives the wallet hold or adds a customer debit.

Admin reads aggregate in SQL over 5m/1h/24h windows and page channels, bindings and attempts. All reads/writes check ACTIVE ADMIN on the server and require same-origin JSON mutations. Monitoring uses actual completion traffic; idle channels show no samples, not a fabricated uptime measurement. Half-open probes are real admitted requests rather than unpaid synthetic completions.

The routing hot path reads five-minute health counters only. Cooled circuits and expired half-open leases receive a recovery opportunity ahead of ordinary ranked channels so a fast or manually preferred backup cannot permanently starve recovery. Admission cleans abandoned attempts conservatively, applies cooldown and serializes the next probe. Other concurrent requests use normal backups; no extra chargeable request is fabricated.

The current real setup remains DeepSeek only. No independent backup credentials have been supplied. Local protocol fixtures verify failover and concurrency without enabling US providers or charging real wallets.

The local Windows runtime uses Next.js's supported Webpack compiler for dev/build because the Turbopack PostCSS worker exits before its IPC connection. Application behavior and design tokens are unchanged.

Retry boundary follows [RFC 9110 section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2). Native error classification remains based on provider documentation, including [DeepSeek errors](https://api-docs.deepseek.com/quick_start/error_codes/).
