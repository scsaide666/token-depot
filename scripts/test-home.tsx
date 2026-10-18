import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../components/ui/tooltip";
import { ApiPreview, homeApiExamples } from "../components/home/api-preview";
import { ProductPreview } from "../components/home/product-preview";
import { ModelsSection } from "../components/home/models-section";
import { PricingSection } from "../components/home/pricing-section";
import type { PublicModel } from "../lib/model-types";

const model: PublicModel = {
  slug: "test-model-id", name: "Catalog fixture model", provider: "DeepSeek",
  description: "A test fixture, never production fallback data.", contextWindow: 128000,
  inputPricePerMillion: "0.00000007", outputPricePerMillion: "123456789.12345678",
};
const render = (element: ReactElement) => renderToStaticMarkup(createElement(TooltipProvider, null, element));
let passed = 0;
function check(name: string, action: () => void) { action(); passed++; console.log(`PASS ${name}`); }

check("Homepage console and pricing render catalog sales prices without float rounding", () => {
  for (const Component of [ProductPreview, PricingSection, ModelsSection]) {
    const html = render(createElement(Component, { catalog: [model], loadError: false }));
    assert(html.includes(model.name) && html.includes("DeepSeek") && html.includes("128,000"));
    assert(html.includes("¥0.00000007") && html.includes("¥123,456,789.12345678"));
    assert(!html.includes("$42.85") && !html.includes("12,842") && !html.includes("Balance recharge"));
  }
});
check("Empty and error catalogs show honest states rather than invented prices or records", () => {
  for (const Component of [ProductPreview, PricingSection, ModelsSection]) {
    const empty = render(createElement(Component, { catalog: [], loadError: false }));
    const error = render(createElement(Component, { catalog: [model], loadError: true }));
    assert(!empty.includes("¥") && !empty.includes("<tbody>"));
    assert(!error.includes("¥") && !error.includes(model.name));
    assert(error.includes('role="status"'));
  }
});
check("curl, JavaScript and Python examples use the supplied origin and real platform slug", () => {
  const base = "http://127.0.0.1:3000/v1";
  const examples = homeApiExamples(base, model.slug);
  for (const example of Object.values(examples)) {
    assert(example.includes(base) && example.includes(model.slug));
    assert(!example.includes("sk-aihub-") && !example.includes("api.aihub.com"));
  }
  const curlBody = examples.curl.split("  -d '")[1].slice(0, -1);
  assert.deepEqual(JSON.parse(curlBody), { model: model.slug, messages: [{ role: "user", content: "Hello, Token Depot." }], stream: true });
  assert(examples.Python.includes("if chunk.choices:"));
  assert(examples.Python.includes("max_retries=0") && examples.JavaScript.includes("maxRetries: 0"));
  const html = render(createElement(ApiPreview, { apiBaseUrl: base }));
  assert(html.includes("YOUR_MODEL_ID") && html.includes("Choose an enabled model"));
});
check("Model text and highlighted code remain escaped HTML", () => {
  const hostile = { ...model, name: '<script>alert("x")</script>', slug: "model'quoted", description: '<img src=x onerror="alert(1)">' };
  const html = render(createElement(ProductPreview, { catalog: [hostile], loadError: false }));
  const terminal = render(createElement(ApiPreview, { apiBaseUrl: "https://platform.example/v1", model: '<script>alert("x")</script>' }));
  assert(!html.includes("<script>") && !html.includes("<img src=x") && !terminal.includes("<script>"));
  assert(homeApiExamples("https://platform.example/v1", hostile.slug).curl.includes("'\\''"));
});
console.log(`Homepage checks passed: ${passed}`);
