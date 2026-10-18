# Admin database data

All Admin pages and APIs check the database-backed ACTIVE session and ADMIN role. A Node.js Next Proxy checks authorization before HTML or RSC streaming, including prefetch and HEAD requests: an ordinary user receives HTTP 403, an anonymous page request redirects to login, and an anonymous API request receives 401. Layouts, page loaders, read services and mutation handlers independently enforce the same permission. Forged user/role headers have no effect. Responses use no-store; sensitive data is explicitly excluded.

## Endpoints

| Endpoint | Result / mutation |
| --- | --- |
| GET /api/admin/overview | Real total/active user counts, today's API financials, date-scoped daily chart and recent records |
| GET /api/admin/users | Search name/email, status; bounded user page with wallet, lifetime spend and request counts |
| GET /api/admin/users/:id | Current user details; no password, session or API key hashes |
| PATCH /api/admin/users/:id | Strict status body: ACTIVE or SUSPENDED |
| POST /api/admin/users/:id/balance | Audited balance adjustment |
| GET /api/admin/requests | Date/user/model/status filters, aggregate totals and paginated request history |
| GET /api/admin/payments | Date/user/method/status filters and paginated Alipay / WeChat Pay orders |
| GET /api/admin/models | Search/provider/date filters, paginated costs/prices and per-model usage/financials |
| POST /api/admin/models, PATCH /api/admin/models/:id | Existing ADMIN-only model management |

Queries reject unknown/duplicate fields, invalid UUIDs/enums, malformed dates and oversized strings. All tables use page / pageSize (10, 25 or 50; default 25); out-of-range pages clamp to the final page. Ordering is createdAt DESC, id DESC. Requests accept a database model UUID or public model slug. User details link to history filters, and show the user ID for manual filtering. Search is case insensitive, with SQL wildcard characters escaped as literals.

## Statistics and dates

- All amounts are CNY Decimal strings; they are never converted to Float for billing or financial summaries.
- Revenue is SUM(ApiRequest.userCost) for settled requests in the selected creation-date range. Top-ups and manual credits/debits are excluded.
- Provider cost is SUM(ApiRequest.providerCost) for settled requests, including known costs of failed requests; these may produce negative profit.
- Gross profit = Revenue - Provider cost, using 80-digit Decimal arithmetic and 20 fractional places.
- Requests count all attempts, including PENDING / FAILED. Tokens sum known recorded totalTokens.
- NULL historical or unknown costs stay unavailable, rather than becoming zero in a row. Totals include known costs only; unknownCosts reports completed requests with missing costs.
- Active Users means status ACTIVE, including active administrator accounts; it does not mean daily unique API callers.
- User Lifetime Spend comes from negative USAGE ledger amounts only. The table's Balance includes reserved funds; View User also shows Reserved and Available balance.
- Dates use UTC, with from inclusive and to inclusive through the whole end date (SQL uses an exclusive next-day boundary). Windows are limited to 366 days. Requests/payments default to the last 30 calendar days; Overview's chart defaults to seven. Today's metrics always use the current UTC day.
- Model statistics default to lifetime; setting dates scopes them by request creation time. Historical price snapshots, not current model prices, determine logged costs.
- Payments filter on order creation time and show paidAt separately; viewing Admin orders never confirms payment, closes an order, or credits a wallet.
- Every application database connection sets timezone=UTC, as required by adapter-pg timestamp normalization. The database's OS/session default need not be UTC.

Counts, SUMs and per-page grouped aggregates run in PostgreSQL. Read transactions use RepeatableRead so counts, totals and rows share a snapshot. Only a bounded page reaches the client; Overview includes at most four recent users, five recent requests and 366 daily buckets. Existing user/model/key history indexes are retained; global timestamp/status/provider indexes and payment method indexes support Admin queries. User name/email substring search uses pg_trgm GIN indexes (the trusted extension is installed by migration).

## Wallet adjustment

POST /api/admin/users/:id/balance accepts exactly:

```json
{
  "direction": "ADD",
  "amount": "10.00",
  "reason": "Support credit for incident",
  "adjustmentId": "a-new-uuid-for-this-attempt"
}
```

Amount must be positive, use at most two decimal places and be no more than ¥1,000,000; reason is required (3–200 trimmed characters). Actor adminId always comes from the session. The transaction rechecks/locks the active ADMIN actor, locks the target Wallet row with FOR UPDATE, checks balanceAfter >= reservedBalance, updates the balance and creates one ADMIN_ADJUSTMENT ledger. It records signed amount, adminId, reason, adjustmentId, balanceBefore and balanceAfter.

The unique (adminId, adjustmentId) key and wallet lock make retries idempotent across processes. Identical retries return the original ledger entry without another update; conflicting details receive 409. The UI retains its attempt ID during an uncertain response so retrying cannot silently credit twice. Database constraints reject missing audit fields, invalid ledger arithmetic and non-admin/inactive actors; an audit entry cannot be rewritten or converted from another ledger type. Reserved funds cannot be deducted. Other billing and payment operations use the same wallet row lock.

Suspend updates status and deletes every session owned by that user in one transaction. API-key authentication independently checks status. Unsuspend restores ACTIVE and requires a fresh login; old sessions are not revived. Administrators cannot suspend their own account.

An adjustment appears as Balance adjustment in the user's existing Billing ledger. It is excluded from spending/revenue statistics. There is no customer-accessible adjustment endpoint, payment simulation, new refund function or permission editing API.

## Validation

Build first, then run npm run test:admin. The script uses only local aihub_auth_test PostgreSQL and a separate Redis test namespace, plus production servers on ports 3130 and 3131. It checks real 403 responses (HTML/RSC/prefetch/HEAD), mutation permission/CSRF, role/expiry/status refresh, UTC day boundaries, Decimal profit, filters/pagination, suspension, audited/idempotent/concurrent wallet changes, ledger constraints and 12,000-row aggregation. Fixtures are removed on exit. No live upstream or payment platform is called.
