import assert from "node:assert/strict";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { TooltipProvider } from "../components/ui/tooltip";
import { HighlightedCode } from "../components/docs/highlighted-code";
import { ModelReference } from "../components/models/model-reference";
import { Playground, UsageStats } from "../components/playground/playground";
import { searchDocumentation } from "../lib/docs-search";
import { buildModelsExamples, buildRequestExamples } from "../lib/docs-content";
import { estimatedOutputBudget, confirmedActualCost } from "../lib/developer-presentation";
import type { PlaygroundModel, PlaygroundStats } from "../lib/playground-types";

let passed = 0;
function renderToStaticMarkup(node: ReactNode) { return renderMarkup(<TooltipProvider>{node}</TooltipProvider>); }
function check(name: string, action: () => void) { action(); passed++; console.log(`PASS ${name}`); }
const model: PlaygroundModel = { slug: "fixture-chat", name: "Fixture Chat", provider: "DeepSeek", description: "Text model", contextWindow: 128000, inputPricePerMillion: "0.00000000000000000001", outputPricePerMillion: "2.5", parameters: { temperature: null, maxOutputTokens: 4096, defaultOutputTokens: 512 } };
const stats: PlaygroundStats = { requestId: "fixture-run", status: "SUCCESS", model: model.slug, inputTokens: 1, outputTokens: 2, totalTokens: 3, latencyMs: 842, actualCost: "0.00000000000000000001", currency: "CNY", errorCode: null, availableBalance: "10", balanceDisplay: "¥10.00" };

check("Full-text search matches all terms, supports Chinese and prioritizes exact topic titles", () => {
  const entries = [{ id: "chat", title: "Chat", section: "Reference", text: "Use a Bearer API key. 余额不足" }, { id: "key", title: "API Key", section: "Reference", text: "Create your API key here." }];
  assert.equal(searchDocumentation(entries, "  API   KEY ")[0].id, "key");
  assert.equal(searchDocumentation(entries, "Bearer key")[0].id, "chat");
  assert.equal(searchDocumentation(entries, "余额不足")[0].id, "chat");
  assert.equal(searchDocumentation(entries, "missing key").length, 0);
  assert.equal(searchDocumentation(entries, " ").length, 0);
});
check("Highlighted code remains inert even with nested fences and HTML injection", () => {
  const code = 'const x = 42;\n```\n<script>alert(1)</script>\n```';
  const html = renderToStaticMarkup(<HighlightedCode language="javascript" code={code} />);
  assert(html.includes("hljs-keyword") && html.includes("hljs-number"));
  assert(!html.includes("<script") && !html.includes("<img") && html.includes("alert"));
  assert(renderToStaticMarkup(<HighlightedCode language="SSE" code="data: [DONE]" />).includes("data: [DONE]"));
});
check("Catalog examples target the real public endpoint and chat examples contain placeholders only", () => {
  const catalog = buildModelsExamples("https://platform.example/v1");
  for (const example of Object.values(catalog)) { assert(example.code.includes("https://platform.example/api/models")); assert(!example.code.includes("/v1/models")); }
  for (const example of Object.values(buildRequestExamples("https://platform.example/v1", model.slug, true))) {
    assert(example.code.includes("AIHUB_API_KEY") && example.code.includes(model.slug));
    assert(example.code.includes("include_usage") && !example.code.includes("sk-"));
  }
});
check("Model reference preserves precise published prices without inventing advanced features or routing", () => {
  const html = renderToStaticMarkup(<ModelReference model={model} />);
  assert(html.includes(model.slug) && html.includes("¥0.00000000000000000001") && html.includes("128,000"));
  assert(html.includes("SSE streaming") && html.includes("Enabled in catalog"));
  assert(html.includes("Images, tools and function calling are not implemented"));
  assert(html.includes("YOUR_API_DOMAIN") && !html.includes("providerModel") && !html.includes("markupMultiplier"));
});
check("Output-only estimates retain Decimal precision and reject invalid settings", () => {
  assert.equal(estimatedOutputBudget("0.00000000000000000001", 1), "¥0.00000000000000000000000001");
  assert.equal(estimatedOutputBudget("2.5", 1000000), "¥2.5");
  assert.equal(estimatedOutputBudget("2.5", 512), "¥0.00128");
  assert.equal(estimatedOutputBudget("0", 1), "¥0");
  assert.equal(estimatedOutputBudget("bad", 1), null);
  assert.equal(estimatedOutputBudget("1", NaN), null);
});
check("Actual cost requires confirmed usage and successful settlement; pending and rejected usage remain unknown", () => {
  assert.equal(confirmedActualCost(stats), "¥0.00000000000000000001");
  for (const value of [null, { ...stats, status: "PENDING" as const }, { ...stats, status: "FAILED" as const }, { ...stats, inputTokens: null }, { ...stats, totalTokens: 99 }, { ...stats, actualCost: null }]) assert.equal(confirmedActualCost(value), null);
  const html = renderToStaticMarkup(<UsageStats stats={{ ...stats, inputTokens: null, actualCost: "0" }} busy={false} />);
  assert(/data-stat="Actual cost"[^>]*>—/.test(html));
  assert(renderToStaticMarkup(<UsageStats stats={stats} busy={false} />).includes(stats.requestId));
});
check("Playground uses server-provided parameter controls and distinguishes output estimate from final billing", () => {
  const html = renderToStaticMarkup(<Playground models={[model]} initialBalance="¥10.00" />);
  assert(html.includes('id="playground-model"') && html.includes('id="playground-max-tokens"'));
  assert(!html.includes('id="playground-temperature"'));
  assert(html.includes("Estimated output budget") && html.includes("Excludes input tokens"));
  assert(html.includes("Actual cost appears only after confirmed token usage"));
  assert(!html.includes("apiKey") && !html.includes("sk-"));
  const available = renderToStaticMarkup(<Playground models={[{ ...model, parameters: { ...model.parameters, temperature: { min: 0, max: 2, default: 0.7 } } }]} initialBalance="¥10.00" />);
  assert(available.includes('id="playground-temperature"'));
});
console.log(`Developer UI checks: ${passed} passed (SSR/semantic checks, not browser layout validation).`);
