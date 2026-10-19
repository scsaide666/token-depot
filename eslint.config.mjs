import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["tooling/eslint-glob/index.cjs"],
    rules: {
      // Next's CommonJS plugin loads this entry synchronously. Keep the rule
      // enabled and allow only the two imports used by the scoped adapter.
      "@typescript-eslint/no-require-imports": ["error", { allow: ["^node:path$", "^tinyglobby$"] }],
    },
  },
  globalIgnores([
    ".next/**", "out/**", "generated/**", "docker-test-results/**", "next-env.d.ts",
    "deploy/secrets/**", "deploy/payment-keys/**", "deploy/local-test-secrets/**",
    "deploy/local-test-payment-keys/**", "backups/**", "browser-results/**", "work/**", "coverage/**",
  ]),
]);
