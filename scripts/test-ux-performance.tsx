import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { latestReadRequests } from "../lib/client/latest-read";
import { requestSignal } from "../lib/client/request-signal";
import { CodeExample, RequestExamples } from "../components/docs/code-example";
import { ModelReferenceLoading } from "../components/models/model-reference-loading";
import { Table, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { TooltipProvider } from "../components/ui/tooltip";
import { buildRequestExamples } from "../lib/docs-content";
import { THEME_COLORS } from "../lib/theme-config";

let passed = 0;
async function check(name: string, action: () => unknown) { await action(); passed++; console.log(`PASS ${name}`); }
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function main() {
  await check("Identical in-flight analytics reads share work; completed responses are not cached", async () => {
    const reads = latestReadRequests(), held = gate(); let calls = 0;
    const execute = async () => { calls++; await held.promise; };
    const first = reads.run("/api/dashboard/usage?range=7D", execute);
    const second = reads.run("/api/dashboard/usage?range=7D", execute);
    assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1);
    held.release(); await first;
    await reads.run("/api/dashboard/usage?range=7D", execute); assert.equal(calls, 2);
  });
  await check("A newer filter aborts the old read; a late old completion cannot cancel the new read", async () => {
    const reads = latestReadRequests(), old = gate(), next = gate(); let oldSignal!: AbortSignal, nextSignal!: AbortSignal;
    const first = reads.run("old", async signal => { oldSignal = signal; await old.promise; });
    await Promise.resolve();
    const second = reads.run("next", async signal => { nextSignal = signal; await next.promise; });
    await Promise.resolve(); assert(oldSignal.aborted && !nextSignal.aborted);
    old.release(); await first;
    assert.equal(reads.run("next", async () => { throw new Error("Duplicate read"); }), second);
    next.release(); await second;
  });
  await check("Payment confirmation forces a fresh read and component cleanup aborts it", async () => {
    const reads = latestReadRequests(), held = gate(); const signals: AbortSignal[] = [];
    const execute = async (signal: AbortSignal) => { signals.push(signal); await held.promise; };
    const first = reads.run("billing", execute); await Promise.resolve();
    const fresh = reads.run("billing", execute, true); await Promise.resolve();
    assert.notEqual(first, fresh); assert(signals[0].aborted && !signals[1].aborted);
    reads.cancel(); assert(signals[1].aborted); held.release(); await Promise.all([first, fresh]);
  });
  await check("Analytics filter URLs take the installed Next Router synchronization path", () => {
    // Execute Next's actual history wrapper against a small in-memory history,
    // then invoke the call used by analytics. This is a Node integration check.
    const router = readFileSync(new URL("../node_modules/next/dist/client/components/app-router.js", import.meta.url), "utf8");
    const wrapper = router.match(/window\.history\.replaceState = function replaceState[\s\S]*?\n        };/)?.[0];
    const analytics = readFileSync(new URL("../components/dashboard/analytics/use-analytics.ts", import.meta.url), "utf8");
    const call = analytics.match(/window\.history\.replaceState\([^;]+\);/)?.[0];
    assert(wrapper && call, "Review the history integration when Next changes its wrapper.");
    const restored: string[] = [], state = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { fixture: true } };
    const history: { state: unknown; replaceState: (data: unknown, title: string, url: string) => void } = { state, replaceState: () => {} };
    const context = {
      window: { history, location: { pathname: "/dashboard/usage" } }, params: new URLSearchParams({ range: "30D", page: "2" }),
      originalReplaceState: (data: unknown) => { history.state = data; },
      copyNextJsInternalHistoryState: (data: object | null) => ({ ...data, ...state }),
      applyUrlFromHistoryPushReplace: (url: string) => { restored.push(url); },
    };
    runInNewContext(wrapper, context); runInNewContext(call, context);
    assert.deepEqual(restored, ["/dashboard/usage?range=30D&page=2"]);
    assert.equal((history.state as typeof state).__NA, true);
  });
  await check("Unmount cancellation also works with an already-aborted parent signal", async () => {
    const parent = new AbortController(), request = requestSignal(1000, parent.signal);
    parent.abort(); assert(request.signal.aborted && !request.timedOut); request.dispose();
    const previous = requestSignal(1000, parent.signal); assert(previous.signal.aborted); previous.dispose();
  });
  await check("A timeout aborts a pending response body; disposed successful reads do not time out", async () => {
    const request = requestSignal(10);
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      request.signal.addEventListener("abort", () => controller.error(new DOMException("Cancelled", "AbortError")), { once: true });
    } }));
    try { await assert.rejects(() => response.json(), { name: "AbortError" }); assert(request.timedOut); }
    finally { request.dispose(); }
    const success = requestSignal(10); success.dispose(); await new Promise(resolve => setTimeout(resolve, 25));
    assert(!success.signal.aborted && !success.timedOut);
  });
  await check("Request deadlines work without AbortSignal.any or AbortSignal.timeout", async () => {
    const any = Object.getOwnPropertyDescriptor(AbortSignal, "any"), timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
    try {
      Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true });
      Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
      const request = requestSignal(10);
      await new Promise<void>(resolve => request.signal.addEventListener("abort", () => resolve(), { once: true }));
      assert(request.timedOut); request.dispose();
    } finally { if (any) Object.defineProperty(AbortSignal, "any", any); if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout); }
  });
  await check("Server-rendered docs keep highlighted code, copy labels and all searchable languages", () => {
    const examples = buildRequestExamples("https://platform.example/v1", "model-slug");
    const html = renderToStaticMarkup(<TooltipProvider><CodeExample language="JavaScript" label="SDK setup" code={'const value = "<script>";'} /><RequestExamples examples={examples} /></TooltipProvider>);
    assert(html.includes("hljs-keyword") && !html.includes("<script>"));
    assert(html.includes('translate="no"') && html.includes('aria-label="Copy SDK setup"'));
    assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
    assert.equal((html.match(/hidden=""/g) ?? []).length, 2);
    for (const language of ["curl", "python", "javascript"]) assert(html.includes(`language-${language === "curl" ? "bash" : language}`));
    assert(html.includes("AIHUB_API_KEY") && html.includes("model-slug") && !html.includes("sk-"));
  });
  await check("Model reference loading is announced, and table headers identify their columns", () => {
    const html = renderToStaticMarkup(<><ModelReferenceLoading /><Table><TableHeader><TableRow><TableHead>Model</TableHead><TableHead scope="row">Override</TableHead></TableRow></TableHeader></Table></>);
    assert(html.includes('role="status"') && html.includes("Loading model reference"));
    assert(html.includes('scope="col"') && html.includes('scope="row"'));
  });
  await check("Mobile browser theme colors match the shared light and dark background tokens", () => {
    const css = readFileSync(new URL("../app/brand-tokens.css", import.meta.url), "utf8");
    for (const [selector, theme] of [[":root", "light"], [".dark", "dark"]] as const) {
      const body = css.slice(css.indexOf(selector)).split("}")[0];
      assert.equal(body.match(/--background:\s*(#[a-f\d]+);/i)?.[1].toLowerCase(), THEME_COLORS[theme]);
    }
  });
  console.log(`UX and performance regression checks: ${passed} passed (Node/SSR, not browser or Lighthouse validation).`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
