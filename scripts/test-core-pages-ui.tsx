import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactElement } from "react";
import { KeysTable } from "../components/dashboard/api-keys/keys-table";
import { ModelsPage } from "../components/dashboard/models/models-page";
import { ModelCard } from "../components/dashboard/models/model-card";
import { filterConsoleModels, priceAtMost, catalogCapabilities } from "../components/dashboard/models/catalog-filters";
import { UsagePage } from "../components/dashboard/usage/usage-page";
import { BillingPage } from "../components/dashboard/billing/billing-page";
import { PaymentCheckout } from "../components/dashboard/billing/payment-checkout";
import { RequestHistory } from "../components/dashboard/usage/request-history";
import type { PublicModel } from "../lib/model-types";
import type { ApiKeyRecord } from "../lib/api-key-types";
import type { BillingData, UsageData } from "../lib/analytics-types";
import type { PaymentStatus, PaymentStatusData } from "../lib/payment-types";

const date = "2026-10-11T12:00:00.000Z";
const model: PublicModel = { slug: "ui-fixture", name: "Fixture model", provider: "DeepSeek", description: "A test fixture, never production data.", contextWindow: 128000, inputPricePerMillion: "1.00000000000000000001", outputPricePerMillion: "5.00000000000000000001" };
const pagination = { page: 2, pageSize: 10, total: 31, totalPages: 4 };
const usage: UsageData = { query: { range: "7D", page: 2, pageSize: 10 }, start: date, end: date, stats: { requests: "12345", tokens: "987654", spend: "0.00000000000000000001", averageLatencyMs: 720, errorRate: "2.50", failedRequests: "2", pendingRequests: "1" }, points: [], requests: [{ id: "record", requestId: "request", model: model.slug, apiKeyName: "Fixture key", inputTokens: null, outputTokens: null, totalTokens: null, cost: null, latencyMs: 0, status: "PENDING", createdAt: date }], pagination, filters: { models: [{ label: model.name, value: "model-id" }], apiKeys: [{ label: "Fixture key", value: "key-id" }] } };
const options = { enabled: false, methods: [{ method: "ALIPAY" as const, enabled: false }, { method: "WECHAT" as const, enabled: false }] };
const billing: BillingData = { availableBalance: "12345.1234567890123456789", reservedBalance: "0.00000000000000000001", monthSpend: "1.25", lifetimeSpend: "3.50", paymentOptions: options, pagination, rechargePagination: pagination, transactions: [{ id: "ledger", createdAt: date, type: "USAGE", amount: "-0.00000000000000000001", balanceAfter: "12345.1234567890123456789", description: "Fixture charge" }], recharges: [{ id: "order", orderNo: "ORDER-FIXTURE", method: "ALIPAY", status: "PENDING", amount: "50.00", currency: "CNY", createdAt: date }, { id: "order2", orderNo: "ORDER-WECHAT", method: "WECHAT", status: "PAID", amount: "20.00", currency: "CNY", createdAt: date }] };
const router = { bfcacheId: "ui-fixture", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const render = (element: ReactElement) => renderToStaticMarkup(<AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>);
let passed = 0;
function check(name: string, action: () => void) { action(); passed++; console.log(`PASS ${name}`); }

check("API key table renders masked metadata and all statuses, with a keyboard-accessible scroll region", () => {
  const key: ApiKeyRecord = { id: "key", name: "<script>key</script>", keyPrefix: "sk-aihub-ab12", createdAt: date, updatedAt: date, lastUsedAt: null, expiresAt: null, revokedAt: null, status: "active" };
  const html = render(<KeysTable records={[key, { ...key, id: "revoked", status: "revoked" }, { ...key, id: "expired", status: "expired" }]} onCopy={() => {}} onAction={() => {}} />);
  assert(html.includes("sk-aihub-ab12••••••••") && html.includes("Never"));
  for (const text of ["Active", "Revoked", "Expired", "Last Used", "Created (UTC)"]) assert(html.includes(text));
  assert(html.includes('role="region"') && html.includes('tabindex="0"') && !html.includes("<script>"));
  assert(!html.includes("keyHash") && !html.includes("passwordHash"));
});
check("Price filters retain Decimal boundaries and combine with search, provider and context", () => {
  assert(!priceAtMost(model.inputPricePerMillion, "1"));
  assert(priceAtMost("1.00000000000000000000", "1") && priceAtMost("0.99999999999999999999", "1"));
  assert(!priceAtMost("5.00000000000000000001", "5"));
  const small = { ...model, slug: "small", contextWindow: 127999, inputPricePerMillion: "0.5" };
  assert.deepEqual(filterConsoleModels([model, small], "ui-fixture", "DeepSeek", "standard", "long-context").map(item => item.slug), [model.slug]);
  assert.equal(filterConsoleModels([model, small], "", "All", "low", "all").length, 1);
  assert.equal(filterConsoleModels([model], "", "OpenAI", "all", "all").length, 0);
  assert.deepEqual(catalogCapabilities(small), ["Chat"]);
});
check("Models show actual sales prices, IDs, view controls and honest empty/error states", () => {
  const html = render(<ModelsPage catalog={[model]} loadError={false} />);
  for (const text of ["ui-fixture", "¥1.00000000000000000001", "128,000", "Input price", "Capability", 'aria-label="Grid view"', 'aria-label="List view"']) assert(html.includes(text));
  assert(!html.includes("Reasoning") && !html.includes("Vision") && !html.includes("providerModel") && !html.includes("markupMultiplier"));
  const empty = render(<ModelsPage catalog={[]} loadError={false} />), error = render(<ModelsPage catalog={[]} loadError />);
  assert(empty.includes("No models available") && !empty.includes("GPT-5"));
  assert(error.includes("Model catalog unavailable"));
  const card = render(<ModelCard model={{ ...model, name: "<script>unsafe</script>" }} onViewDetails={() => {}} />);
  assert(card.includes("Long context") && card.includes("View details") && !card.includes("<script>"));
});
check("Usage preserves real values, unknown usage and cost, filters, and disabled 90D", () => {
  const html = render(<UsagePage initialData={usage} />);
  for (const text of ["12,345", "987,654", "¥0.00000000000000000001", "720ms", "2.50%", "Total Cost", "Pending", "—", 'aria-label="Filter by Model"', 'aria-label="Filter by API Key"']) assert(html.includes(text));
  assert(/<button[^>]*disabled=""[^>]*aria-label="90 days, not available yet"/.test(html));
  assert(html.includes("Page 2 of 4") && html.includes('aria-label="Request history pagination"'));
  const loading = render(<RequestHistory data={usage} loading onPageChange={() => {}} />);
  assert(loading.includes("Loading request history") && loading.includes("Page 2 of 4"));
  assert(/disabled=""[^>]*aria-label="Next request history page"/.test(loading));
});
check("Billing preserves exact ledger values, both payment methods and disabled merchant configuration", () => {
  const html = render(<BillingPage initialData={billing} />);
  for (const text of ["¥12,345.1234567890123456789", "−¥0.00000000000000000001", "Balance After", "Alipay", "WeChat Pay", "Pending", "Paid", "Lifetime Spend"]) assert(html.includes(text));
  assert(/<button[^>]*disabled=""[^>]*>Recharge<\/button>/.test(html));
  assert(html.includes("Payment methods are currently unavailable"));
  assert(html.includes('aria-label="Transaction history pagination"') && html.includes('aria-label="Recharge history pagination"'));
  const empty = render(<BillingPage initialData={{ ...billing, transactions: [], recharges: [] }} />);
  assert(empty.includes("No transactions yet") && empty.includes("No recharges yet"));
});
check("Payment UI only reports confirmed status and exposes no provider credentials", () => {
  for (const [status, title] of [["PENDING", "Waiting for payment"], ["PAID", "Payment successful"], ["FAILED", "Payment could not be completed"], ["CLOSED", "Payment closed"], ["REFUNDED", "Payment refunded"]] as [PaymentStatus, string][]) {
    const data: PaymentStatusData = { order: { ...billing.recharges[0], status, creditAmount: "50.00", walletCurrency: "CNY", expiresAt: "2026-10-11T12:05:00.000Z", paidAt: status === "PAID" ? date : null }, availableBalance: "82.43", reservedBalance: "0", serverTime: date, qrCodeDataUrl: null };
    const html = render(<PaymentCheckout initialData={data} options={options} />);
    assert(html.includes(title));
    assert.equal(html.includes("Your balance has been updated."), status === "PAID");
    assert(!html.includes("privateKey") && !html.includes("signature") && !html.includes("UPSTREAM_API_KEY"));
  }
});
console.log(`Core console UI checks passed: ${passed}`);
