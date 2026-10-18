# Dashboard, Usage and Billing data

All three pages read PostgreSQL at request time and preserve the existing dashboard design. Initial data is rendered on the server; interactive filters and pagination call authenticated, non-cached read endpoints.

## Endpoints and ownership

| Endpoint | Query parameters |
| --- | --- |
| GET /api/dashboard/overview | range: 24H / 7D / 30D (default 7D) |
| GET /api/dashboard/usage | range, modelId, apiKeyId, status, page, pageSize |
| GET /api/dashboard/billing | page, pageSize, rechargePage |

The read service itself obtains the current ACTIVE Session. It has no caller-supplied user ID. Every request query includes that user's ID; ledger queries use the wallet owner's ID. This applies equally to USER and ADMIN sessions: an admin's personal dashboard is still their own data.

Unknown or duplicate parameters that reach the application, malformed UUIDs and invalid enum/page values return 400. In particular, userId and walletId overrides are rejected. Next normalizes some prototype-related URL keys before the handler; ownership remains enforced regardless of that normalization. A foreign model/API-key filter returns an empty owned result, not another user's data or an existence disclosure. Anonymous, expired, forged and suspended sessions receive 401. Mutating methods are not exposed. API responses use Cache-Control: no-store and nosniff.

Analytics DTOs explicitly include final user charges only. They omit provider costs, markup, upstream model IDs, secrets, hashes and owner IDs. SQL is parameterized. Deleted API keys retain request history with an unavailable-key label; deleted models retain the saved slug where available. Older records with no model snapshot can display the current slug or an unavailable-model label.

## Statistics and time

Overview shows:

- Available balance: balance minus reservedBalance.
- Requests/tokens created during the current UTC calendar month.
- This-month spend from settled USAGE ledger entries in that UTC month.
- A rolling 24-hour / 7-day / 30-day request chart and the latest five owned requests.

Usage filters apply to statistics, chart and request history together. The range is rolling, ending at the query's current time. Charts have 24 one-hour buckets or 7/30 one-day buckets, anchored to the range start; missing buckets return zeros. All timestamp labels are UTC.

Total requests count all owned ApiRequest records in the view, including preflight failures and Pending requests. Total tokens sum trusted stored usage. Known usage from failed upstream responses is included; missing usage remains NULL in request history. Average latency and error rate exclude Pending requests. Error rate is Failed / (Success + Failed). An empty completed set has no average latency and a zero error rate.

Usage spend sums final userCost by request creation time. Historical unbilled records and Pending requests have NULL final costs; they do not add to spend and display a dash in history. A failed, finalized billed-stage request has zero final user cost. No reservation is presented as actual spending.

Billing shows CNY available/reserved balances, UTC this-month spend, lifetime spend, real WalletTransaction pages and separately paginated Recharge History. Ledger pages contain USAGE and RECHARGE entries; both spend totals include only finalized USAGE ledger entries, classified by ledger creation time. Recharges do not inflate consumption totals. Usage and Billing can therefore assign a request to different periods if it starts before a period boundary and settles afterwards. Amounts are not repriced or recomputed from current model metadata.

Money remains Decimal in SQL and server calculations, and uses fixed-20 decimal strings in DTOs. Request counts and aggregate token counts are also strings. Client chart geometry may approximate values as Number solely to draw SVG coordinates and axis ticks; exact totals, tooltip values and transaction amounts use the original strings.

## Pagination and queries

Request and transaction history use database count plus bounded skip/take queries. Default page size is 25; only 10, 25 and 50 are allowed. Pages must be integers from 1 to 100000. Out-of-range pages are clamped to the last existing page; empty views report page 1 with zero records.

Rows sort by createdAt DESC, id DESC for deterministic ordering when timestamps tie. Changing any Usage filter resets pagination to page 1. Offset pages represent current data rather than a permanent export snapshot; newly inserted rows can shift subsequent pages.

Each read uses a short Repeatable Read transaction so aggregates, page count, chart and rows share one database snapshot. Network calls are outside these transactions. COUNT/SUM/AVG and time-bucket grouping execute in PostgreSQL; complete request histories are never loaded into browser state to calculate totals.

Owner-first composite indexes cover:

- ApiRequest(userId, createdAt, id)
- ApiRequest(userId, status, createdAt, id)
- ApiRequest(userId, modelId, createdAt, id)
- ApiRequest(userId, apiKeyId, createdAt, id)
- WalletTransaction(walletId, createdAt, id)

Existing billing recovery indexes are retained. Model filter choices come from that user's own history, and API-key choices come from owned key metadata. Each option list is capped at 200; direct validated filters remain supported beyond that list.

## UI states and scope

Pages have loading skeletons, true empty states, retryable errors and accessible pagination. Filter requests cancel superseded requests; a slower previous selection cannot overwrite the latest selection. Displayed history uses NULL markers for unavailable billing/usage, muted Pending/Success badges and a restrained Failed badge. Tables scroll within their containers on mobile.

Add Balance opens an owned real order flow only when the corresponding merchant configuration is available. Otherwise its entry is disabled with an availability message. Payment confirmation refreshes balances, Recharge History and transaction history; see [payments.md](payments.md). Admin account/payment tables remain UI demonstrations. New registered wallets continue to start at zero.

## Verification

After a production build:

~~~sh
npm run test:dashboard
npm test
~~~

test:dashboard uses only the isolated local aihub_auth_test database and a temporary production Next server on port 3111. It creates USER/ADMIN/empty-account fixtures, settled/failing/Pending requests and ledgers, checks ownership in APIs and server-rendered pages, exercises combined filters, stable pagination and minimum 10^-20 charges, and removes its data on exit.

The large-history check inserts 12000 test requests, verifies database aggregates and index migration, and confirms that the response contains only 25 history rows and a bounded chart/metadata payload. It neither calls a real upstream nor processes payments.
