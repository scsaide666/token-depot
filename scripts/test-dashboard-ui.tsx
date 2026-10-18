import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountProvider } from "../components/auth/account-provider";
import { TooltipProvider } from "../components/ui/tooltip";
import { DashboardOverview } from "../components/dashboard/overview";
import { OverviewMetrics } from "../components/dashboard/overview-metrics";
import { DashboardRecentRequests } from "../components/dashboard/recent-requests";
import { DashboardQuickStart } from "../components/dashboard/quick-start";
import { dashboardLinkActive, dashboardNavigation, dashboardPageLabel } from "../components/dashboard/navigation";
import type { OverviewData, RequestRecord } from "../lib/analytics-types";
import type { AccountUser } from "../lib/account-types";

const date = "2026-10-11T12:00:00.000Z";
const data: OverviewData = {
  availableBalance: "0.00000000000000000001", reservedBalance: "0", monthSpend: "123456789.1234567890123456789",
  month: { requests: "12345", tokens: "9876543210", spend: "0", averageLatencyMs: null, errorRate: "0.00", failedRequests: "0", pendingRequests: "0" },
  range: "7D", start: date, end: date,
  points: Array.from({ length: 7 }, (_, index) => ({ date, label: `Oct ${index + 1}`, requests: "0", tokens: "0", spend: "0" })), recentRequests: [],
};
const user: AccountUser = { id: "fixture", name: "UI fixture", email: "fixture@example.test", role: "USER", status: "ACTIVE", createdAt: date, updatedAt: date, wallet: { balance: "0", reservedBalance: "0", balanceDisplay: "¥0.00" } };
const apiBaseUrl = "http://127.0.0.1:3000/v1";
let passed = 0;
function check(name: string, action: () => void) { action(); passed++; console.log(`PASS ${name}`); }

check("Overview preserves exact monetary strings and truthful monthly metric labels", () => {
  const html = renderToStaticMarkup(<OverviewMetrics data={data} />);
  assert(html.includes("¥0.00000000000000000001") && html.includes("¥123,456,789.1234567890123456789"));
  assert(html.includes("12,345") && html.includes("9,876,543,210"));
  assert(html.includes("Requests This Month") && html.includes("Spend This Month") && !html.includes("Lifetime"));
});
check("Zero activity shows honest chart and request empty states; unsupported 90D is disabled", () => {
  const html = renderToStaticMarkup(<AccountProvider user={user}><TooltipProvider><DashboardOverview initialData={data} models={[]} modelLoadError={false} apiBaseUrl={apiBaseUrl} /></TooltipProvider></AccountProvider>);
  assert(html.includes("No API activity yet") && html.includes("No requests yet"));
  assert(html.includes("No models are available") && html.includes("YOUR_MODEL_ID"));
  assert(/<button[^>]*disabled=""[^>]*aria-label="90 days, not available yet"/.test(html));
  assert(!html.includes("12,482") && !html.includes("gpt-5") && !html.includes("$42.85"));
});
check("Recent requests preserve unconfirmed token/cost states and tiny confirmed charges", () => {
  const pending: RequestRecord = { id: "pending", requestId: "request-pending", model: "test-slug", apiKeyName: "Fixture key", inputTokens: null, outputTokens: null, totalTokens: null, cost: null, latencyMs: 0, status: "PENDING", createdAt: date };
  const complete = { ...pending, id: "complete", requestId: "request-complete", status: "SUCCESS" as const, inputTokens: 1, outputTokens: 0, totalTokens: 1, cost: "0.00000000000000000001", latencyMs: 100 };
  const html = renderToStaticMarkup(<DashboardRecentRequests records={[pending, complete]} />);
  assert(html.includes("Pending") && html.includes("Success") && html.includes("¥0.00000000000000000001"));
  assert(html.includes("—") && !/>¥0\.00</.test(html));
  assert(html.includes('role="region"') && html.includes('tabindex="0"'));
});
check("Navigation preserves all destinations and selects nested Billing without matching unrelated prefixes", () => {
  assert.deepEqual(dashboardNavigation.map(item => item.label), ["Overview", "API Keys", "Models", "Usage", "Billing", "Documentation", "Playground"]);
  assert(dashboardLinkActive("/dashboard/billing/payments/fixture", "/dashboard/billing"));
  assert(!dashboardLinkActive("/dashboard/billing-other", "/dashboard/billing") && !dashboardLinkActive("/dashboard/usage", "/dashboard"));
  assert.equal(dashboardPageLabel("/dashboard/billing/payments/fixture"), "Payment details");
  assert.equal(dashboardPageLabel("/dashboard/settings"), "Settings");
});
check("Quick Start uses current model and origin, escapes names, and never inserts credentials", () => {
  const html = renderToStaticMarkup(<DashboardQuickStart models={[{ name: '<script>alert("fixture")</script>', slug: "enabled-fixture" }]} loadError={false} apiBaseUrl={apiBaseUrl} />);
  assert(html.includes("enabled-fixture") && html.includes(apiBaseUrl));
  assert(!html.includes("<script>") && !html.includes("sk-aihub-") && !html.includes("api.aihub.com"));
  assert(html.includes("AIHUB_API_KEY") && html.includes('aria-label="Copy API example"'));
  const error = renderToStaticMarkup(<DashboardQuickStart models={[]} loadError apiBaseUrl={apiBaseUrl} />);
  assert(error.includes("Models could not be loaded") && error.includes('role="status"'));
});
console.log(`Dashboard UI checks passed: ${passed}`);
