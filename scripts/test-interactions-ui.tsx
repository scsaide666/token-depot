import assert from "node:assert/strict";
import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../components/ui/button";
import { Feedback } from "../components/ui/feedback";
import { HomeNavbar } from "../components/home/navbar";
import { FinalCta } from "../components/home/final-cta";
import { ConsoleSelect, ConsoleTableSkeleton } from "../components/dashboard/console-primitives";
import { SegmentedControl } from "../components/dashboard/usage/segmented-control";

let passed = 0;
function check(name: string, action: () => void) { action(); passed++; console.log(`PASS ${name}`); }

check("Loading actions are disabled and expose busy state without changing their accessible label", () => {
  const html = renderToStaticMarkup(<Button loading type="submit">Creating payment…</Button>);
  assert(html.includes('disabled=""') && html.includes('aria-busy="true"'));
  assert(html.includes('aria-hidden="true"') && html.includes("Creating payment…"));
  assert(!/\sloading="true"/.test(html));
  const ready = renderToStaticMarkup(<Button>Create API Key</Button>);
  assert(!ready.includes('disabled=""') && !ready.includes('aria-busy="true"') && !ready.includes("ui-loading-dots"));
  assert(renderToStaticMarkup(<Button disabled>Unavailable</Button>).includes('disabled=""'));
});
check("Navigation buttons preserve native anchor semantics and do not add nested interactive wrappers", () => {
  const html = renderToStaticMarkup(<Button asChild><a href="/docs">Documentation</a></Button>);
  assert(html.startsWith("<a ") && html.includes('href="/docs"') && !html.includes("<button"));
  assert(!html.includes("ui-loading-dots"));
});
check("Feedback announces results and errors safely; empty feedback is inert and hidden", () => {
  const success = renderToStaticMarkup(<Feedback message="API key created." />);
  assert(success.includes('role="status"') && success.includes('aria-live="polite"'));
  const error = renderToStaticMarkup(<Feedback message="<script>fixture</script>" error />);
  assert(error.includes('role="alert"') && !error.includes("<script>"));
  const empty = renderToStaticMarkup(<Feedback message="" />);
  assert(empty.includes('hidden=""') && empty.includes('inert=""'));
});
check("Closed mobile navigation cannot receive keyboard focus and keeps truthful expanded state", () => {
  const html = renderToStaticMarkup(<HomeNavbar currentPage="models" />);
  assert(html.includes('aria-expanded="false"'));
  assert(/<nav[^>]*id="mobile-navigation"[^>]*hidden=""[^>]*inert=""/.test(html));
  assert(html.includes('aria-current="page"'));
  assert(html.includes('href="/docs"') && html.includes('href="/login"') && html.includes('href="/register"'));
  const cta = renderToStaticMarkup(<FinalCta />);
  assert(cta.includes('href="/register"') && cta.includes('href="/docs"'));
  assert(!cta.includes('<button'));
});
check("Filters and segmented controls expose actual selection; loading tables keep accessible placeholders", () => {
  const options = [{ value: "all", label: "All" }, { value: "deepseek", label: "DeepSeek" }] as const;
  const selected = renderToStaticMarkup(<ConsoleSelect label="Provider" value="deepseek" options={options} onChange={() => {}} />);
  assert(selected.includes('data-filter-active="true"') && selected.includes('value="deepseek" selected=""'));
  const all = renderToStaticMarkup(<ConsoleSelect label="Provider" value="all" options={options} onChange={() => {}} />);
  assert(!all.includes('data-filter-active="true"'));
  const segment = renderToStaticMarkup(<SegmentedControl label="Provider" value="deepseek" options={options} onChange={() => {}} />);
  assert(segment.includes('role="radiogroup"') && segment.includes('aria-checked="true"'));
  const loading = renderToStaticMarkup(<ConsoleTableSkeleton label="Updating request history" rows={2} />);
  assert(loading.includes('role="status"') && loading.includes('aria-hidden="true"'));
  assert.equal((loading.match(/class="console-skeleton-row"/g) ?? []).length, 2);
});
check("Motion supports reduced motion and closed disclosures retain no interaction", () => {
  const css = fs.readFileSync(new URL("../app/interactions.css", import.meta.url), "utf8");
  assert(css.includes("prefers-reduced-motion: reduce") && css.includes("transform: none !important"));
  assert(css.includes("animation: none !important; transition: none !important"));
  assert(css.includes("display: none !important") && css.includes("pointer-events: none"));
  assert(!css.includes("transition: all") && !css.includes("rotate("));
});
console.log(`Interaction UI checks passed: ${passed}`);
