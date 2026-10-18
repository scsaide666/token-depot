# Token Depot

An open-source AI API developer platform built with Next.js, TypeScript, PostgreSQL, Prisma and Redis. A blue-and-white Geist interface brings model discovery, API keys, usage, billing and administration together.

**Pre-production software.** Publishing the source does not certify commercial readiness. Real merchant payments, provider permissions and invoiced upstream costs still require operator verification. See [project status and release scope](docs/open-source-status.md) before deploying.

## What is included

- Public model catalog, pricing, API documentation and a responsive Light / Dark / System interface.
- Registration, server-validated sessions, user profiles and server-enforced administration permissions.
- API keys generated with secure randomness, stored as hashes and revealed once on creation.
- An OpenAI-compatible `POST /v1/chat/completions` gateway with streaming, provider adapters, compatible-channel routing, timeouts, rate limits and concurrency protection.
- PostgreSQL Decimal wallet reservations, idempotent settlement and an auditable transaction ledger.
- Usage dashboards, a server-authenticated Playground, Alipay / WeChat Pay integration code and isolated Mock test fixtures.
- Docker Compose templates for Next.js, PostgreSQL, Redis, Caddy and reservation recovery.

Provider adapters exist for DeepSeek, OpenAI, Anthropic and Google Gemini. Their presence is **not** evidence of account access, regional eligibility, resale rights or live acceptance. No provider key, merchant credential, production account, balance or customer database is included.

## Local development

Use Node.js 24 (the production image pins 24.22.0), npm, PostgreSQL 17 and Redis 7.4, or Docker Engine with Compose v2. Windows commands use `npm.cmd` when PowerShell blocks npm's script wrapper.

```bash
git clone https://github.com/scsaide666/token-depot.git
cd token-depot
npm ci
cp .env.example .env
```

Edit the ignored `.env` locally. Set your **development-only** `DATABASE_URL`, Redis connection and a randomly generated `IP_HASH_SECRET`; do not leave the example password placeholders. Use an empty local database that you own. Keep all provider API keys empty and `PAYMENTS_ENABLED=false` for a UI-only preview. The Prisma CLI reads `.env`; Next.js also reads `.env.local` if you use that for private overrides.

```bash
npm run db:generate
npm run db:migrate
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Register your own local account. New wallets start at zero, and the model catalog is empty until an administrator configures models. No default administrator or shared password is provided. Redis protection deliberately fails closed; a missing Redis service must not be bypassed to make protected actions work.

To preview a production build locally, run `npm run build` followed by `npm run start` after configuring the same development database. Do not run migrations against an existing production database as part of this quick start.

### Isolated Docker preview

The included local test setup generates its own ignored credentials and disables real payments and provider keys. It binds HTTPS only to `localhost:8443`; make sure that port is free. Use a fresh checkout and a separate Compose project so existing containers and volumes remain untouched.

```bash
node scripts/prepare-local-docker-test.mjs

# Bash helper; the explicit project name keeps this preview separate.
compose() {
  docker compose -p token-depot-local -f compose.yaml -f compose.local-test.yaml \
    --env-file .env.docker-test "$@"
}

compose --profile ops --profile local-https build app migrate sse-fixture caddy-local
compose up -d postgres
compose --profile ops run --rm migrate
compose --profile local-https up -d app redis recovery sse-fixture caddy-local
compose --profile local-https ps
```

The local proxy uses Caddy's internal CA. It is not a publicly trusted production certificate; inspect and trust only your own local test CA where appropriate. The test generator refuses to overwrite existing credentials. Never reuse the generated files for production, and never use `down -v` on a project containing data you need.

For PowerShell equivalents and browser tests, see [Windows browser acceptance](docs/browser-acceptance-windows.md). Production templates and preflight instructions are in [DEPLOY.md](DEPLOY.md); they are preparation material, not approval to operate a public paid service.

## API use

Users send a platform key to the gateway, not an upstream provider key. Existing `sk-aihub-` key prefixes, cookie names and internal `AIHUB_*` configuration names remain for compatibility.

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_ENABLED_MODEL_SLUG","messages":[{"role":"user","content":"Hello"}],"max_tokens":64,"stream":false}'
```

This request needs an enabled, configured model and sufficient wallet balance and may incur upstream costs. Use the Mock suites for free integration testing. Client examples are available for [Python](examples/chat.py), [JavaScript](examples/chat.mjs) and [PowerShell / curl](examples/chat-curl.ps1). The public catalog endpoint is `GET /api/models`; this project does not claim a `/v1/models` endpoint.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run test:home
npm run test:dashboard-ui
npm run test:core-ui
npm run build
```

`npm test` runs database integration tests, not a dependency-free unit suite. Use only an isolated local database named `aihub_auth_test`, set `DATABASE_URL_TEST` and `REDIS_URL_TEST`, apply the included test setup and reserve the fixtures' local ports. Never point it at customer data. Python SDK checks need Python 3, the packages in `scripts/requirements-sdk.txt`, and optionally `PYTHON_TEST_EXECUTABLE`. Some test helpers create and remove their own fixture records. Detailed workflows are documented in [streaming](docs/streaming.md), [API risk controls](docs/api-risk.md), [payments](docs/payments.md) and [performance operations](docs/performance-operations.md).

Browser tests and Lighthouse require separate local tool installation; see the Windows guide. Historical internal audit reports, credentials, screenshots containing accounts and database backups are intentionally outside this public repository. Checks of a local build do not establish real-provider or real-merchant readiness.

The included `.gitleaks.toml` extends default detection rules and narrowly recognizes literal example placeholders. With Gitleaks installed, scan the repository history with `gitleaks git --log-opts="--all" --redact --ignore-gitleaks-allow` before publishing your own changes.

## Security and production boundaries

- Keep `.env*`, payment key files, credentials, backups and runtime data out of Git and container images. Only placeholder example files are tracked.
- Do not expose PostgreSQL or Redis publicly. Review domains, HTTPS, allowed upstream origins, trusted proxy headers, rate limits and backup recovery before deployment.
- The current cache-token / time-dependent upstream pricing configuration has not been reconciled against real supplier invoices. Treat reported provider cost and margin as configuration-based figures until verified.
- Account recovery, password-changing UI and account deletion are not complete production workflows. Merchant credentials, off-machine backup recovery and applicable operating permissions remain operator work.
- Review known limitations in [open-source status](docs/open-source-status.md). Follow [SECURITY.md](SECURITY.md) to report vulnerabilities privately; never attach secrets or customer data to a public issue.

## License

Original project code is released under the [MIT License](LICENSE). Third-party code and fonts keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This repository is independent of Vercel and the AI or payment providers it integrates with.
