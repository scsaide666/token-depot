# Lint dependency security

Updated: 2026-10-19. This change concerns development tooling, not the API Gateway, model prices, wallet, payment callbacks, sessions or database schema.

## Cause

The five HIGH entries were one advisory propagated through this dependency chain:

```text
eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces
```

[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) covers `braces <= 3.0.3`; the advisory did not list a patched release when checked. Updating to `braces 3.0.3` does not fix this advisory. The npm audit suggestion to downgrade the Next ESLint configuration is not used.

## Scoped replacement

The application keeps Next.js and `eslint-config-next` at 16.3.8. The plugin's [directory discovery helper](https://github.com/vercel/next.js/blob/v16.3.8/packages/eslint-plugin-next/src/utils/get-root-dirs.ts) uses only `globSync(string, { onlyDirectories: true })`.

A local development dependency named `fast-glob` resolves to the first-party package `@token-depot/eslint-glob` under `tooling/eslint-glob`. A version-scoped npm override makes that exact Next plugin use the local dependency. The adapter uses the already present `tinyglobby` package pinned at 0.2.17; it does not include `braces` or `micromatch`.

This is an actual removal of the vulnerable dependency chain, not an audit allowlist or a renamed copy of `braces`. The adapter is **not a general fast-glob implementation**. It rejects unexpected arguments and options. Review its contract before upgrading the Next ESLint plugin or using another package manager.

The adapter explicitly disables directory expansion and preserves absolute-path semantics, including a root equal to the current directory, a current directory containing literal braces, and a filesystem root. Absolute patterns use the filesystem root as their glob working directory so escaped current-directory names cannot change root discovery. These matter because a direct alias to tinyglobby changes static-directory behavior; see its [migration guide](https://superchupu.dev/tinyglobby/migration) and [options reference](https://superchupu.dev/tinyglobby/documentation).

The two CommonJS imports needed by the adapter have exact module-name exceptions scoped to that one file. The import rule stays enabled, and application lint rules are unchanged. Docker copies the local package before `npm ci`; do not omit it from the build context.

Lint also excludes local secret, backup and generated test-output directories. This prevents traversal of access-controlled credentials; no credential permissions are loosened and application source directories remain checked.

## Verification

```bash
npm ci
npm run test:lint-security
npm run lint
npm run typecheck
npm run build
npm audit --registry=https://registry.npmjs.org
```

The security regression checks the lockfile and actual module resolution, missing links, static/glob/array/absolute/Windows root paths, rejection of unsupported calls, and actual Next ESLint diagnostics. It creates and removes only its own temporary fixture directory. No provider credentials, environment files, payments or databases are used.

Test results and dependency scans are time-specific. Removing this development dependency issue does not certify Docker OS packages, real-provider billing, merchant access or production readiness.

## Local results, 2026-10-18–19

- Full official npm audit of the final lockfile: **0 advisories**, down from five HIGH dependency entries.
- Clean isolated `npm ci` and the original ten lint-security checks passed on October 18. After fixing the additional absolute-path edge cases, all **13** regression checks passed on October 19.
- ESLint and TypeScript checks: passed; all 113 effective application lint rules are unchanged.
- Twelve existing UI/client/polling/recovery/preflight suites: passed.
- Production build, 50 pages and font-preload verification: passed using placeholder build configuration.
- Real database integration, Linux/Docker image execution and OS CVE scans were not repeated in this fix. No live provider request, payment or production deployment was performed.
