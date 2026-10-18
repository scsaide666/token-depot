import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { KeysTable } from "../components/dashboard/api-keys/keys-table";
import { ResponsiveFilters } from "../components/ui/responsive-filters";
import { ConsoleSelect } from "../components/dashboard/console-primitives";
import { UsageLineChart } from "../components/dashboard/usage/usage-line-chart";
import { DataPagination } from "../components/dashboard/analytics/pagination";
import type { ApiKeyRecord } from "../lib/api-key-types";

// These are semantic/SSR regression checks, not browser viewport or geometry tests.
let passed = 0;
function check(name: string, action: () => void) { action(); passed++; console.log(`PASS ${name}`); }

check("Compact API key rows keep masked data, dates, status and a named action without rendering secrets", () => {
  const date = "2026-10-11T12:00:00.000Z";
  const fixture = { id: "responsive-fixture", name: "VeryLongDevelopmentKey".repeat(3) + "<script>", keyPrefix: "sk-aihub-ab12", keyHash: "private-hash-fixture", fullKey: "sk-aihub-private-secret-fixture", createdAt: date, updatedAt: date, lastUsedAt: null, expiresAt: null, revokedAt: date, status: "revoked" } satisfies ApiKeyRecord & { keyHash: string; fullKey: string };
  const html = renderToStaticMarkup(<KeysTable records={[fixture]} onCopy={() => {}} onAction={() => {}} />);
  assert(html.includes("sk-aihub-ab12••••••••") && html.includes("Created Oct 11, 2026 UTC") && html.includes("Last used Never"));
  assert(html.includes("Revoked") && html.includes("Actions for VeryLongDevelopmentKey"));
  assert(!html.includes(fixture.fullKey) && !html.includes(fixture.keyHash) && !html.includes("<script>"));
  assert(/title="sk-aihub-ab12••••••••"/.test(html));
  assert(html.includes('role="region"') && html.includes('tabindex="0"'));
});

check("Filter disclosures link a native button to its fields and preserve the actual selected option", () => {
  const html = renderToStaticMarkup(<ResponsiveFilters activeCount={1}><ConsoleSelect label="Provider" value="deepseek" options={[{ value: "all", label: "All" }, { value: "deepseek", label: "DeepSeek" }]} onChange={() => {}} /></ResponsiveFilters>);
  const target = html.match(/aria-controls="([^"]+)"/)?.[1];
  assert(target && html.includes(`id="${target}"`));
  assert(html.includes('type="button"') && html.includes('aria-expanded="false"'));
  assert(html.includes("1<span") && html.includes(" active</span>"));
  assert(html.includes('value="deepseek" selected=""') && html.includes('aria-label="Provider"'));
  // Desktop fields must never be made globally inert/hidden by the mobile state.
  assert(!html.includes('inert=""') && !html.includes('hidden=""'));
});

check("Responsive charts retain keyboard/touch instructions and finite SVG geometry with one real data point", () => {
  const html = renderToStaticMarkup(<UsageLineChart points={[{ label: "Oct 11", tokens: "1", requests: "1", spend: "0.00000000000000000001" }]} metric="tokens" />);
  assert(html.includes('aria-roledescription="interactive line chart"') && html.includes('tabindex="0"'));
  assert(html.includes("Hover or tap") && html.includes("left and right arrow keys"));
  assert(html.includes('viewBox="0 0 700 240"') && html.includes('cx="350"'));
  assert(!html.includes("NaN") && !html.includes("Infinity"));
});

check("Pagination preserves native disabled actions and announces the current page while loading", () => {
  const html = renderToStaticMarkup(<DataPagination pagination={{ page: 2, pageSize: 10, total: 31, totalPages: 4 }} label="Request history" disabled onChange={() => {}} />);
  assert(html.includes("Showing 11–20 of 31") && html.includes("Page 2 of 4"));
  assert(html.includes('role="status"') && html.includes('aria-label="Request history pagination"'));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
});
console.log(`Responsive semantic UI checks passed: ${passed}`);
