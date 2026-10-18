// Run only from an interactive local terminal with browser access permitted.
// This script never creates keys, sends model requests, or starts payments.
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";

const base = new URL(process.env.AIHUB_BROWSER_BASE_URL ?? "http://127.0.0.1:3000/");
if (!["http:", "https:"].includes(base.protocol) || !["127.0.0.1", "localhost"].includes(base.hostname) || base.pathname !== "/" || base.search || base.hash) {
  throw new Error("AIHUB_BROWSER_BASE_URL must be a loopback origin, such as https://localhost:8443/.");
}

const widths = [375, 390, 768, 1024, 1440, 1920];
const themes = ["light", "dark"];
const publicRoutes = ["/", "/login", "/register", "/models", "/pricing", "/docs", "/terms", "/privacy", "/refund-policy", "/acceptable-use", "/contact", "/design-system"];
const protectedRoutes = ["/dashboard", "/dashboard/api-keys", "/dashboard/models", "/dashboard/usage", "/dashboard/billing", "/dashboard/settings", "/playground"];
const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputDir = path.resolve("browser-results", runId);
const results = [];
const transientSecrets = [];
const redact = (value) => {
  let safe = String(value).replace(/sk-(?:aihub-)?[A-Za-z0-9_-]{10,}/g, "[REDACTED_KEY]");
  for (const secret of [process.env.AIHUB_BROWSER_TEST_EMAIL, process.env.AIHUB_BROWSER_TEST_PASSWORD, ...transientSecrets]) {
    if (secret) safe = safe.replaceAll(secret, "[REDACTED_CREDENTIAL]");
  }
  return safe.slice(0, 700);
};
const routeName = (route) => route === "/" ? "home" : route.slice(1).replaceAll("/", "-");
const height = (width) => width < 768 ? 812 : width < 1024 ? 1024 : 900;
const record = (entry) => { results.push(entry); console.log(`${entry.status.toUpperCase()} ${entry.name}`); };

async function inspect(page, route, width, theme, label = routeName(route)) {
  const errors = [];
  const onConsole = (message) => { if (message.type() === "error") errors.push(redact(message.text())); };
  const onPageError = (error) => errors.push(redact(error.message));
  const onResponse = (response) => {
    const url = new URL(response.url());
    if (url.origin === base.origin && url.pathname.startsWith("/api/") && response.status() >= 400) {
      errors.push(`API ${response.status()} ${url.pathname}`);
    }
  };
  const onRequestFailed = (request) => {
    const url = new URL(request.url());
    if (url.origin === base.origin && !request.failure()?.errorText.includes("ERR_ABORTED")) {
      errors.push(`Request failed ${url.pathname}: ${redact(request.failure()?.errorText ?? "unknown")}`);
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  const name = `${label} ${width}px ${theme}`;
  try {
    await page.setViewportSize({ width, height: height(width) });
    const response = await page.goto(new URL(route, base).href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 15000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(350);
    const layout = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const offenders = documentWidth > viewport + 1 ? [...document.querySelectorAll("body *")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.right > viewport + 1 && getComputedStyle(element).position !== "fixed";
        })
        .slice(0, 8)
        .map((element) => ({ tag: element.tagName.toLowerCase(), className: String(element.className).slice(0, 100) })) : [];
      return { viewport, documentWidth, offenders, heading: document.querySelector("h1")?.textContent?.trim() ?? "", darkClass: document.documentElement.classList.contains("dark"), title: document.title, legacyBrandVisible: /AI ?Hub/.test(document.body.innerText), brandMarkPresent: !!document.querySelector('img[src*="token-depot-mark"]') };
    });
    const screenshot = `${theme}-${width}-${label}.png`;
    await page.screenshot({ path: path.join(outputDir, screenshot), animations: "disabled", fullPage: width === 375 || width === 1440 });
    const actualPath = new URL(page.url()).pathname;
    const issues = [];
    if (!response?.ok()) issues.push(`HTTP ${response?.status() ?? "no response"}`);
    if (actualPath !== route) issues.push(`Unexpected route ${actualPath}`);
    if (layout.documentWidth > layout.viewport + 1) issues.push(`Horizontal overflow ${layout.documentWidth - layout.viewport}px`);
    if (layout.darkClass !== (theme === "dark")) issues.push(`Theme class is ${layout.darkClass ? "dark" : "light"}`);
    if (!layout.title.includes("Token Depot")) issues.push("Page title is missing Token Depot branding");
    if (layout.legacyBrandVisible) issues.push("Legacy display brand is visible");
    if (!layout.brandMarkPresent) issues.push("Token Depot brand mark is missing");
    if (errors.length) issues.push(`${errors.length} console/page errors`);
    record({ name, status: issues.length ? "fail" : "pass", route, width, theme, httpStatus: response?.status() ?? null, screenshot, ...layout, issues, errors });
  } catch (error) {
    record({ name, status: "fail", route, width, theme, issues: [redact(error?.message ?? error)], errors });
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }
}

async function interaction(name, action) {
  try { await action(); record({ name, status: "pass" }); }
  catch (error) { record({ name, status: "fail", issues: [redact(error?.message ?? error)] }); }
}

async function publicInteractions(page, width, theme) {
  await interaction(`Home navigation ${width}px ${theme}`, async () => {
    await page.setViewportSize({ width, height: height(width) });
    await page.goto(base.href, { waitUntil: "domcontentloaded" });
    if (width < 768) {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Models" }).click();
    } else {
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Models" }).click();
    }
    await page.waitForURL("**/models", { timeout: 15000 });
  });
  await interaction(`Models search ${width}px ${theme}`, async () => {
    await page.goto(new URL("/models", base).href, { waitUntil: "domcontentloaded" });
    const search = page.getByRole("searchbox", { name: "Search models" });
    await search.fill("aihub-no-such-model-acceptance-test");
    await page.getByRole("heading", { name: "No models found" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Clear search" }).click();
    if (await search.inputValue() !== "") throw new Error("Model search did not clear.");
  });
  await interaction(`Pricing search ${width}px ${theme}`, async () => {
    await page.goto(new URL("/pricing", base).href, { waitUntil: "domcontentloaded" });
    const search = page.getByRole("searchbox", { name: "Search Model" });
    await search.fill("aihub-no-such-model-acceptance-test");
    await page.getByRole("heading", { name: "No models found" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Clear search" }).click();
    if (await search.inputValue() !== "") throw new Error("Pricing search did not clear.");
  });
  await interaction(`Docs search dialog ${width}px ${theme}`, async () => {
    await page.goto(new URL("/docs", base).href, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Search documentation" }).click();
    const dialog = page.getByRole("dialog", { name: "Search documentation" });
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("searchbox", { name: "Search documentation text" }).fill("stream");
    await dialog.getByRole("status").getByText(/results/).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  });
  await interaction(`Login password control ${width}px ${theme}`, async () => {
    await page.goto(new URL("/login", base).href, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Show password" }).click();
    if (await page.getByLabel("Password", { exact: true }).getAttribute("type") !== "text") throw new Error("Password visibility did not change.");
    await page.getByRole("button", { name: "Hide password" }).click();
  });
}

async function dashboardInteractions(page, width, theme) {
  await interaction(`Dashboard navigation ${width}px ${theme}`, async () => {
    await page.setViewportSize({ width, height: height(width) });
    await page.goto(new URL("/dashboard", base).href, { waitUntil: "domcontentloaded" });
    if (width < 1024) {
      await page.getByRole("button", { name: "Open sidebar" }).click();
      await page.getByRole("navigation", { name: "Mobile dashboard navigation" }).getByRole("link", { name: "Models" }).click();
    } else {
      await page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Models" }).click();
    }
    await page.waitForURL("**/dashboard/models", { timeout: 15000 });
  });
  await interaction(`API key create dialog ${width}px ${theme}`, async () => {
    await page.goto(new URL("/dashboard/api-keys", base).href, { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: "Create API Key" }).first();
    await trigger.waitFor({ state: "visible" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Create API Key" });
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("textbox", { name: "Key Name" }).fill("Browser acceptance only");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  });
  await interaction(`Usage range ${width}px ${theme}`, async () => {
    await page.goto(new URL("/dashboard/usage", base).href, { waitUntil: "domcontentloaded" });
    const range = page.getByRole("radiogroup", { name: "Time range" });
    await range.getByRole("radio", { name: "7D" }).click();
    await range.getByRole("radio", { name: "7D" }).waitFor({ state: "visible" });
    if (await range.getByRole("radio", { name: "7D" }).getAttribute("aria-checked") !== "true") throw new Error("Usage range did not select 7D.");
  });
  await interaction(`Playground settings ${width}px ${theme}`, async () => {
    await page.goto(new URL("/playground", base).href, { waitUntil: "domcontentloaded" });
    if (width < 1024) {
      const toggle = page.getByRole("button", { name: "Toggle model settings" });
      await toggle.click();
      if (await toggle.getAttribute("aria-expanded") !== "true") throw new Error("Playground settings did not open.");
    } else {
      await page.getByRole("complementary", { name: "Model settings" }).waitFor({ state: "visible" });
    }
    // Do not send a prompt: this acceptance run must never call a paid upstream.
  });
  await interaction(`Settings API URL ${width}px ${theme}`, async () => {
    await page.goto(new URL("/dashboard/settings", base).href, { waitUntil: "domcontentloaded" });
    const actual = await page.locator("#settings-base-url").inputValue();
    const expected = `${base.origin}/v1`;
    if (actual !== expected) throw new Error(`Settings API URL does not match this deployment: ${actual}`);
  });
}

async function fillHydratedAuthForm(page, fields, submitName) {
  // Next.js can paint the server form before React attaches input handlers.
  // A pre-hydration fill looks populated, while the disabled button still
  // reflects the initial empty React state.
  await page.waitForLoadState("networkidle", { timeout: 15000 });
  const submit = page.getByRole("button", { name: submitName, exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const [label, value] of fields) await page.getByLabel(label, { exact: true }).fill(value);
    if (await submit.isEnabled()) return submit;
    await page.waitForTimeout(500);
  }
  throw new Error(`${submitName} remains disabled after filling the hydrated form.`);
}

async function submitAuthForm(page, submit, action) {
  const endpoint = `/api/auth/${action}`;
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === base.origin && url.pathname === endpoint && response.request().method() === "POST";
  }, { timeout: 20000 });
  await submit.click();
  const response = await responsePromise;
  if (!response.ok()) {
    const body = await response.json().catch(() => null);
    const details = [body?.error, ...Object.values(body?.fieldErrors ?? {})]
      .filter((value) => typeof value === "string").map(redact).join(" ");
    throw new Error(`${action} returned HTTP ${response.status()}${details ? `: ${details}` : ""}`);
  }
  return response.status();
}

async function registerIsolatedUser(browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const suffix = randomBytes(10).toString("hex");
  const email = `browser-${suffix}@example.com`;
  const password = `Browser-${randomBytes(18).toString("base64url")}9!`;
  transientSecrets.push(email, password);
  let state;
  await interaction("Isolated test-user registration", async () => {
    await page.goto(new URL("/register", base).href, { waitUntil: "domcontentloaded" });
    const submit = await fillHydratedAuthForm(page, [["Name", "Browser Acceptance"], ["Email", email], ["Password", password], ["Confirm Password", password]], "Create account");
    const status = await submitAuthForm(page, submit, "register");
    state = await context.storageState();
    if (status !== 201) throw new Error(`register returned unexpected HTTP ${status}`);
    await page.waitForURL("**/dashboard", { timeout: 20000 });
  });
  await context.close();
  if (!state) return undefined;

  const loginContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const loginPage = await loginContext.newPage();
  let loginState;
  await interaction("Isolated test-user login", async () => {
    await loginPage.goto(new URL("/login", base).href, { waitUntil: "domcontentloaded" });
    const submit = await fillHydratedAuthForm(loginPage, [["Email", email], ["Password", password]], "Sign in");
    await submitAuthForm(loginPage, submit, "login");
    await loginPage.waitForURL("**/dashboard", { timeout: 20000 });
    loginState = await loginContext.storageState();
  });
  await loginContext.close();
  return loginState;
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { throw new Error("Project-local Playwright is missing. Run: npm.cmd install --no-save --package-lock=false playwright lighthouse"); }
  const browser = await chromium.launch({ headless: true, ...(process.env.AIHUB_BROWSER_CHROME_PATH ? { executablePath: process.env.AIHUB_BROWSER_CHROME_PATH } : {}) });
  try {
    for (const theme of themes) {
      const context = await browser.newContext({ colorScheme: theme, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
      await context.addInitScript((mode) => localStorage.setItem("token-ui-theme", mode), theme);
      const page = await context.newPage();
      for (const route of publicRoutes) for (const width of widths) await inspect(page, route, width, theme);
      for (const width of widths) await publicInteractions(page, width, theme);
      if (theme === "light") for (const route of ["/dashboard", "/playground"]) {
        await interaction(`Anonymous protection ${route}`, async () => {
          await page.goto(new URL(route, base).href, { waitUntil: "domcontentloaded" });
          await page.waitForURL("**/login", { timeout: 15000 });
        });
      }
      await context.close();
    }

    const email = process.env.AIHUB_BROWSER_TEST_EMAIL;
    const password = process.env.AIHUB_BROWSER_TEST_PASSWORD;
    let state;
    if (email && password) {
      const loginContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
      const loginPage = await loginContext.newPage();
      await interaction("Local test-user login", async () => {
        await loginPage.goto(new URL("/login", base).href, { waitUntil: "domcontentloaded" });
        const submit = await fillHydratedAuthForm(loginPage, [["Email", email], ["Password", password]], "Sign in");
        await submitAuthForm(loginPage, submit, "login");
        await loginPage.waitForURL("**/dashboard", { timeout: 20000 });
        // Keep the session only in memory. Never write cookies or passwords to artifacts.
        state = await loginContext.storageState();
      });
      await loginContext.close();
    } else if (process.env.AIHUB_BROWSER_CREATE_TEST_USER === "1") {
      // Opt in only when the loopback app uses an isolated test database.
      state = await registerIsolatedUser(browser);
    } else {
      record({ name: "Authenticated pages", status: "skip", reason: "Set AIHUB_BROWSER_CREATE_TEST_USER=1 only for an isolated test database, or provide dedicated local AIHUB_BROWSER_TEST_EMAIL and AIHUB_BROWSER_TEST_PASSWORD." });
    }
    if (state) for (const theme of themes) {
        const context = await browser.newContext({ storageState: state, colorScheme: theme, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
        await context.addInitScript((mode) => localStorage.setItem("token-ui-theme", mode), theme);
        const page = await context.newPage();
        for (const route of protectedRoutes) for (const width of widths) await inspect(page, route, width, theme);
        for (const width of widths) await dashboardInteractions(page, width, theme);
        await context.close();
    }
  } finally { await browser.close(); }
}

let fatalError = null;
try { await run(); }
catch (error) { fatalError = redact(error?.message ?? error); console.error(`FATAL ${fatalError}`); }
const summary = {
  generatedAt: new Date().toISOString(), baseURL: base.href,
  environment: process.env.AIHUB_BROWSER_CHROME_PATH ? "local system Chrome (Chromium engine)" : "local Playwright Chromium", browserExecuted: !fatalError,
  counts: Object.fromEntries(["pass", "fail", "skip"].map((status) => [status, results.filter((entry) => entry.status === status).length])),
  fatalError, results,
};
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "results.json"), JSON.stringify(summary, null, 2));
console.log(`Results: ${path.join(outputDir, "results.json")}`);
if (fatalError || summary.counts.fail) process.exitCode = 1;
