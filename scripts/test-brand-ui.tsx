import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { Brand } from "../components/brand";
import { ProviderMark, ApiRequestFlow, TokenUsageBreakdown } from "../components/brand-primitives";
import { ThemeProvider } from "../components/theme-provider";
import { ThemeSwitch } from "../components/theme-switch";
import { colorTokens } from "../lib/design-tokens";
import { THEME_STORAGE_KEY } from "../lib/theme-config";
import { TooltipProvider } from "../components/ui/tooltip";
import { Foundations } from "../components/design-system/foundations";

let passed = 0;
function check(name: string, action: () => void) { action(); passed++; console.log(`PASS ${name}`); }
const css = fs.readFileSync(new URL("../app/brand-tokens.css", import.meta.url), "utf8");
function properties(selector: string) {
  const body = css.slice(css.indexOf(selector)).split("}")[0];
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
}
const light = properties(":root"), dark = { ...light, ...properties(".dark") };
function luminance(hex: string) {
  assert(/^#[a-f0-9]{6}$/i.test(hex));
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) { const values = [luminance(a), luminance(b)].sort((x, y) => x - y); return (values[1] + 0.05) / (values[0] + 0.05); }

check("Published design-system swatches match the actual root and dark palettes", () => {
  for (const token of colorTokens) {
    assert.equal(light[token.variable].toLowerCase(), token.light.toLowerCase());
    assert.equal(dark[token.variable].toLowerCase(), token.dark.toLowerCase());
  }
  for (const file of ["../components/home/vercel-home.css", "../components/dashboard/console.css", "../components/dashboard/core-pages.css"]) {
    const page = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert(!/--(?:background|foreground|primary|card|border|secondary|muted-foreground)\s*:/.test(page), "A page must not override the shared theme palette");
  }
});
check("Text, primary actions, danger actions and keyboard focus meet contrast thresholds in both themes", () => {
  for (const palette of [light, dark]) {
    for (const surface of ["--background", "--secondary", "--card", "--surface-raised"]) {
      for (const text of ["--foreground", "--muted-foreground", "--destructive", "--link"]) assert(contrast(palette[text], palette[surface]) >= 4.5, `${text} on ${surface}`);
      assert(contrast(palette["--ring"], palette[surface]) >= 3, "Keyboard focus needs sufficient contrast");
    }
    assert(contrast(palette["--primary"], palette["--primary-foreground"]) >= 4.5);
    assert(contrast(palette["--primary-hover"], palette["--primary-foreground"]) >= 4.5);
    assert(contrast(palette["--active-foreground"], palette["--active-background"]) >= 4.5);
    assert(contrast(palette["--destructive"], palette["--destructive-foreground"]) >= 4.5);
    for (const code of ["--code-foreground", "--code-muted", "--code-string", "--code-keyword", "--code-number"]) assert(contrast(palette[code], palette["--code-background"]) >= 4.5);
  }
});
check("The actual SSR theme bootstrap applies saved choices or system theme before hydration", () => {
  const html = renderToStaticMarkup(<ThemeProvider nonce="brand-test-nonce"><TooltipProvider><ThemeSwitch /></TooltipProvider></ThemeProvider>);
  const script = html.match(/<script[^>]*nonce="brand-test-nonce"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert(script, "Theme bootstrap must retain its CSP nonce");
  for (const fixture of [
    { saved: null, systemDark: false, result: "light" }, { saved: null, systemDark: true, result: "dark" },
    { saved: "system", systemDark: true, result: "dark" }, { saved: "light", systemDark: true, result: "light" },
    { saved: "dark", systemDark: false, result: "dark" },
  ]) {
    const classes = new Set(["light", "dark", "existing-class"]), style: Record<string, string> = {};
    vm.runInNewContext(script, {
      document: { documentElement: { classList: { remove: (...items: string[]) => items.forEach(item => classes.delete(item)), add: (item: string) => classes.add(item) }, style } },
      window: { matchMedia: () => ({ matches: fixture.systemDark }) },
      localStorage: { getItem: (key: string) => { assert.equal(key, THEME_STORAGE_KEY); return fixture.saved; } },
    }, { timeout: 1000 });
    assert(classes.has(fixture.result) && classes.has("existing-class"));
    assert(!classes.has(fixture.result === "light" ? "dark" : "light"));
    assert.equal(style.colorScheme, fixture.result);
  }
  assert(html.includes('aria-label="浅色模式"') && html.includes('aria-label="深色模式"') && html.includes('aria-label="跟随系统"'));
  assert(!html.includes('aria-pressed="true"'), "SSR controls must not guess saved preference");
});
check("All brand lockups preserve identity, home navigation and decorative-image semantics", () => {
  for (const variant of ["navbar", "sidebar", "auth"] as const) {
    const html = renderToStaticMarkup(<Brand variant={variant} />);
    assert(html.includes('href="/"') && html.includes('aria-label="Token Depot home"') && html.includes("Token Depot"));
    assert(html.includes('alt=""') && html.includes('aria-hidden="true"') && html.includes("token-depot-mark-td.png"));
    assert(!html.includes("Token 首页"));
  }
  assert(renderToStaticMarkup(<ProviderMark provider="<script>" />).includes("&lt;"));
  const flow = renderToStaticMarkup(<ApiRequestFlow />);
  assert.equal((flow.match(/<li>/g) ?? []).length, 3);
  assert(flow.includes("Your selected model") && !flow.includes("Healthy") && !flow.includes("online"));
});
check("Design-system swatches keep identical, theme-neutral SSR labels until hydration", () => {
  const render = (forcedTheme?: string) => renderToStaticMarkup(<ThemeProvider forcedTheme={forcedTheme}><TooltipProvider><Foundations /></TooltipProvider></ThemeProvider>);
  for (const html of [render(), render("dark"), render("light")]) {
    for (const token of colorTokens) assert(html.includes(`复制${token.name}色值 ${token.variable}`));
    assert.equal((html.match(/disabled=""/g) ?? []).length, colorTokens.length);
    assert(html.includes("Border <code") && html.includes("--border"));
  }
});
check("Token graphics use confirmed counts and never invent missing or zero usage", () => {
  for (const [input, output] of [[null, 1], [1, null], [0, 0], [-1, 1], [Infinity, 1], [Number.MAX_SAFE_INTEGER, 1]]) assert.equal(renderToStaticMarkup(<TokenUsageBreakdown input={input} output={output} />), "");
  const measured = renderToStaticMarkup(<TokenUsageBreakdown input={1284} output={438} />);
  assert(measured.includes("1,284 input tokens and 438 output tokens"));
  assert(measured.includes('aria-hidden="true"'));
  const widths = [...measured.matchAll(/width:([\d.]+)%/g)].map(match => Number(match[1]));
  assert.equal(widths.length, 2);
  assert(Math.abs(widths[0] + widths[1] - 100) < 0.000001);
});
console.log(`Brand UI checks passed: ${passed}`);
