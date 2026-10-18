# Model catalog and administration

The Model catalog is backed by PostgreSQL and Prisma. This document covers catalog metadata and prices; invocation and billing are described in [gateway.md](gateway.md) and [billing.md](billing.md).

## Storage and arithmetic

`Model` stores UUID `id`, unique public `slug`, `name`, `provider`, internal `providerModel`, `description`, integer `contextWindow`, `inputPricePerMillion`, `outputPricePerMillion`, `markupMultiplier`, `enabled`, and creation/update timestamps. Providers are `OPENAI`, `ANTHROPIC`, `GOOGLE`, `DEEPSEEK`.

Provider input/output costs are entered in CNY and use PostgreSQL `numeric(22,8)` (14 whole and 8 fractional digits). Existing USD prices were converted once at the approved factor seven; new upstream costs must be supplied in CNY. Markup uses `numeric(12,6)` and defaults to 1. Costs must be non-negative, markup strictly positive, and context strictly positive. Database CHECK constraints enforce these invariants. Prices and markup are submitted and returned as decimal strings; JSON numbers, exponent notation and values beyond the column precision/scale are rejected before storage. Lower-than-one markup is permitted and results in a negative margin.

Sales prices are calculated with a dedicated Prisma Decimal constructor using 50 significant digits:

```
sellingPrice = providerPrice * markupMultiplier
marginPerMillion = sellingPrice - providerPrice
marginPercent = (markupMultiplier - 1) / markupMultiplier * 100
```

Multiplication preserves the full product, including up to 14 fractional digits. No price is converted to JavaScript Number. Prices are formatted without rounding; only the illustrative margin percentage is rounded to four decimal places. Margin percentage is unavailable (`null`) when both provider prices are zero.

## Public boundary

`GET /api/models` is a catalog endpoint, not a gateway endpoint. It always queries `enabled = true`, regardless of submitted query parameters or caller role. Its model objects contain only:

```
slug, name, provider, description, contextWindow,
inputPricePerMillion, outputPricePerMillion
```

The price fields in this public DTO are **selling prices**. Provider costs, markup, internal provider model IDs and margins are excluded by an explicit server-side projection. `/models`, `/dashboard/models`, `/pricing`, and home page model/pricing sections use the same projection. Copy buttons and examples use `slug`, never the database UUID or provider model ID. Pages render at request time, and API responses use `Cache-Control: no-store`.

No illustrative model rows are seeded into the live catalog. An empty database produces an empty state until an administrator creates an enabled model. Capability and use-case fixtures are removed from the real catalog because these fields are not part of the current database contract. Existing documentation examples, usage records and account API preferences remain UI previews.

## Admin endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /api/admin/models` | Server-paginated enabled/disabled models, costs, sales prices, markup, margins and real usage/profit statistics; search/provider/date filters. |
| `POST /api/admin/models` | Create a model; unique slug conflicts return 409. |
| `PATCH /api/admin/models/:id` | Edit allowed fields or enable/disable; missing models return 404. |

Each read and write rechecks the database-backed ACTIVE Session and ADMIN role. Anonymous/expired/suspended sessions receive 401; ordinary users receive 403. Both route handlers and server administration functions enforce this guard. Mutation bodies use strict Zod schemas, same-origin JSON validation and an 8 KB limit. `userId`, `role`, `id` and timestamp injection are rejected. No public write or cost-read endpoint exists. No model deletion endpoint is introduced.

Changing a public slug changes the copied identifier and code examples. Changes become visible on the next catalog request/page reload. Disabling a model keeps its database record but removes it from public and user catalog responses. No provider enablement or upstream connectivity is implied.

ADMIN roles continue to be assigned through a trusted database administration process. No public role promotion or default admin account is added.

## Verification

After a production build, run `npm run test:models`. The suite applies migrations to the isolated local `aihub_auth_test` database and starts a production server on port 3103. It covers create/edit, persistence, disable/enable, admin permission checks, private-field isolation in JSON and server-rendered props, duplicate/invalid data, CSRF, exact multiplication using an independent BigInt oracle, tiny fractions, 32 significant digits, zero costs, database types/constraints, and role/status changes. It removes its own models, users, sessions, wallets and rate-limit fixtures after execution.
