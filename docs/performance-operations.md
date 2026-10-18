# Performance and recovery operations

This stage preserves CNY Decimal accounting, authoritative PostgreSQL Wallet locks,
fresh API key/account checks and payment settlement idempotency. No wallet cache is used.

## Connection budget

The application keeps one Prisma/pg pool per process, not per request. Defaults remain:

| Variable | Default | Maximum |
| --- | ---: | ---: |
| `DATABASE_POOL_MAX` | 10 | 100 |
| `DATABASE_POOL_TIMEOUT_MS` | 5000 | 60000 |
| `DATABASE_POOL_IDLE_MS` | 30000 | 600000 |
| `DATABASE_POOL_LIFETIME_SECONDS` | 1800 | 86400 |

All values must be positive integers. Allocate pool capacity across **all** application
instances, test/worker pools and administrative connections; leave database headroom.
Increasing pool size is not a solution to the single-channel or same-wallet row lock.
Tune from production measurements, not this single-machine short load test.
Provider HTTPS already uses one reusable Undici Agent wrapped for Node's native fetch,
including DNS checks at connection time. Keep that wrapper and SSRF protections intact.

## Redis metadata

* Public model catalog and server-only model configuration: 60-second TTL, keys include
  database identity and a PostgreSQL revision. A statement trigger increments revision
  in the same transaction as INSERT/UPDATE/DELETE/TRUNCATE, including direct SQL writes.
  The next request reads the committed version; old keys expire and cannot be reused
  by that next request. Cache failure falls back to database reads.
* Single-channel five-minute routing statistics: 1-second TTL and concurrent miss
  coalescing. Multiple competing channels use fresh database statistics to preserve
  existing health/latency ranking. Enabled/circuit/capacity/probe decisions always use
  the locked current channel row, never cached statistics.
* No credentials, sessions, API key hashes, balances or permission decisions are cached.
  Cached price configuration is server-only; the public catalog holds selling prices.
* A bounded per-process near cache holds at most 256 entries of at most 12 KB each.
  It uses the same revision keys and Redis remaining TTL, without extending expiry,
  so hot metadata does not need a Redis network round trip on every request.
* Redis metadata entries are bounded to 12 KB; larger catalogs use the database fallback.
  A metadata outage backs off cache attempts for five seconds. Gateway rate limiting
  retains its separate fail-closed protection and cannot be bypassed by this fallback.

## Abandoned reservations

`npm run wallet:recover` is a trusted operator command, with no HTTP endpoint. It finds
up to 100 owners with expired PENDING requests, then uses the existing idempotent
Wallet-lock recovery. It releases holds, marks failures and preserves unknown upstream
cost reconciliation; it does not credit wallets or estimate user charges.

Configure it in the deployment scheduler, for example every minute, and rerun batches
until the returned count is below 100. Scheduling is **not enabled automatically** by
this change. Alert on failures, old PENDING requests, reservation mismatches and unknown
provider costs. Recovery for one owner still processes that owner's expired requests
within one transaction; unusually large accumulated backlogs may require an operational
maintenance window. Do not bypass database constraints to clear holds.

The new `(status, reservationExpiresAt, userId)` index supports this cross-user scan;
the pre-existing `(userId, status, reservationExpiresAt)` supports locked owner recovery.
Request/payment/ledger tables retain server pagination and existing filter indexes.
Apply migrations before deploying the new model cache code. Index creation on a large
production table needs a reviewed maintenance/concurrent-index deployment plan.

## Reproduce isolated load tests

```
npm run performance -- --label=before --duration=5
# deploy optimized build against the same isolated fixture configuration
npm run performance -- --label=after --duration=5
npm run test:performance
node --require ./scripts/performance-server-only.cjs --import tsx scripts/performance-direct.ts
```

Only local `aihub_auth_test`, Redis DB15 and a local deterministic Mock Provider are
allowed by the harness. It never builds or calls a real provider/payment. Every scenario
uses new fixture users/model/channel, audits exact charges and releases, then cleans
only its own rows. Fixture limits are increased to measure capacity while retaining the
actual Gateway, Wallet transactions and channel admission checks. Production defaults
are unchanged.

The default scenario matrix is ordinary/stream × multi-user/same-user × 10/50/100/500
closed-loop VUs. Raw JSON in `work/performance/` includes build/hash/configuration,
request samples, exact latency quantiles, success RPS, errors, first-content latency,
gateway process CPU/memory, sampled PostgreSQL connections and accounting checks.
RPS includes draining in-flight work; unsuccessful attempts are never called throughput.
CPU is gateway-process CPU only, both one-core and machine-normalized. Database counts
exclude the sampler but include any other sessions in the test database. These short
local runs do not establish production capacity or a soak-test result.

`scripts/performance-db.ts` records actual EXPLAIN ANALYZE on an isolated 20,100-row
fixture and rolls its temporary probe index back. `performance-bundle.mjs` compares
unique route-manifest chunks including shared chunks; gzip totals are build estimates,
not measured browser transfer, TTFB, FCP or LCP.

The supplementary direct harness runs 500 same-wallet Gateway handler calls with the
real authentication, Redis, database and Mock Provider. Its isolated bootstrap aliases
only Next's server-only compile marker; no authentication or billing method is mocked.
It bypasses HTTP listener admission and must not be presented as server capacity.
