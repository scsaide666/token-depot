# Open-source status and release scope

Prepared on 2026-10-18 from the existing Token Depot worktree. This is a separate public source snapshot with a new Git history. The original private repository, its commits, uncommitted work and data remain separate.

## What this snapshot preserves

The current application, UI, API routes, permissions, provider adapters, payment code, Prisma schema and migrations are preserved. The supplied blue TD logo and blue-and-white Light / Dark interface are retained. Package dependency versions are unchanged.

Public-release changes are limited to repository metadata, MIT licensing, documentation, ignore rules and portable Python/curl test-runner discovery instead of a maintainer-specific absolute path. Internal identifiers such as `AIHUB_*`, `sk-aihub-` and legacy asset aliases are retained intentionally; changing them would affect compatibility.

## Excluded from publication

- The private repository's original Git history and internal handoff/audit documents.
- All real environment files, provider keys, payment secrets, databases, backups, account screenshots, logs and generated test output.
- Installed dependencies, build artifacts and machine-local runtimes.

Only placeholder environment examples are included. Test code contains generated credentials or explicit local fixtures; these are not access to a real service. Secret scanning reduces publication risk but is not a guarantee that software is free of vulnerabilities.

## Readiness boundaries

| Area | Public release status | What remains |
| --- | --- | --- |
| UI and application source | Included | Verify on your own platform and deployment configuration. |
| Tests | Existing local/Mock suites included | A clean checkout needs its own isolated PostgreSQL, Redis, Python and browser test tools. Historical private test results are not republished as current validation. |
| AI adapters | DeepSeek, OpenAI, Anthropic and Gemini code included | Real keys, eligible regions, supported model IDs, commercial permissions and invoiced usage reconciliation. No official commercial model is seeded automatically. |
| Token billing | Decimal reservations, settlement and ledger code included | Real cache-token / peak-period costs are not fully reconciled; configured provider cost and margin are not independently verified gross profit. |
| Alipay / WeChat Pay | Signed provider integration and Mock fixtures included | Merchant approval, production credentials, public HTTPS callbacks and real reconciliation. Payments stay disabled by default. No live payment acceptance is claimed. |
| Accounts | Registration, login, sessions, roles and name updates included | Password-reset, password-change and account-deletion flows are not complete production account management. |
| Dependencies and containers | Pinned lockfile and image templates included | Prior reviews recorded development-tool HIGH advisories and container CVEs. This source publication does not resolve or certify them. Re-scan at deployment time. |
| Backup and recovery | Encryption and isolated recovery tooling included | An independently authorized off-machine storage target and real disaster-recovery exercise are not certified. |
| Operating eligibility | No approvals bundled | The operator must confirm entity, ICP/telecom and applicable AI-service obligations, merchant access and upstream authorization. Foreign hosting alone is not an exemption. |
| Production deployment | Templates only | No server purchased, no public service enabled, no production migration or payment made by publishing this repository. |

## Checks executed for this public snapshot

On 2026-10-18, a separate local export completed `npm ci`, Prisma client generation, ESLint, TypeScript checking, the production build (including font-preload verification), and 12 existing test suites: homepage, Dashboard UI, core-page UI, interactions, brand, responsive markup, developer UI, UX/performance regression checks, Playground client, payment polling, recovery batching and deployment preflight.

These are local source/build and test-suite checks. They are not a fresh browser, Lighthouse, full database integration, container or real-provider/merchant acceptance run.

The official npm registry audit recorded **5 HIGH development dependency entries** in the ESLint chain: `eslint-config-next`, `@next/eslint-plugin-next`, `fast-glob`, `micromatch` and `braces`. The separate `npm audit --omit=dev` run recorded **0 production dependency advisories** at that time. No forced dependency downgrade or unrelated business-code change was made. This does not cover container OS vulnerabilities or future advisories.

The source comparison verified that 334 application, permission/proxy and Prisma files match the private worktree byte for byte. Secret scanning keeps default Gitleaks rules and only excludes exact non-credential example placeholders in explicitly named documentation/template files; it does not exclude whole source or test directories.

## Where to start

1. Follow the [README](../README.md) for a local preview with empty supplier keys and disabled payments.
2. Review [SECURITY.md](../SECURITY.md) and [DEPLOY.md](../DEPLOY.md).
3. Use the isolated Mock tests before authorizing any paid upstream call or real payment.
4. Complete supplier, merchant, backup, security and operating checks separately before commercial launch.

**This is an open-source publication, not a declaration of commercial launch readiness.**
