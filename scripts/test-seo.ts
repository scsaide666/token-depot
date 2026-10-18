import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { config } from "dotenv";
import { publicMetadata, siteMap, robotRules, privatePath, siteConfiguration } from "../lib/seo";
import { siteContact } from "../lib/server/site-contact";
import { legalDocuments } from "../lib/legal-content";

config({ path: ".env.local", quiet: true }); config({ quiet: true });
const publicEnv: NodeJS.ProcessEnv = { NODE_ENV: "production", APP_ORIGIN: "https://seo-fixture.example.com", SEO_INDEXING_ENABLED: "true" };
const origin = "http://127.0.0.1:3123";
let server: ChildProcess | undefined, passed = 0;
async function check(name: string, action: () => unknown) { await action(); passed++; console.log(`PASS ${name}`); }
async function request(path: string) { return fetch(`${origin}${path}`, { redirect: "manual", headers: { "User-Agent": "Twitterbot/1.0", Host: "attacker.example.test" }, signal: AbortSignal.timeout(20000) }); }
async function main() {
  await check("public metadata uses trusted origin, unique canonical and complete share cards", () => {
    const meta = publicMetadata("/models", "Models · Token Depot", "Available models", publicEnv);
    assert.equal(meta.alternates?.canonical, `${publicEnv.APP_ORIGIN}/models`);
    assert.equal(meta.openGraph?.title, "Models · Token Depot");
    assert(meta.twitter && "card" in meta.twitter); assert.equal(meta.twitter.card, "summary_large_image");
    assert.equal((meta.robots as { index: boolean }).index, true);
    assert(JSON.stringify(meta).includes("/social/token-depot.png"));
  });
  await check("sitemap contains only nine public pages and no invented modification dates", () => {
    const map = siteMap(publicEnv);
    assert.equal(map.length, 9); assert.equal(new Set(map.map(item => item.url)).size, 9);
    assert(map.every(item => !privatePath(new URL(item.url).pathname) && !item.lastModified));
    assert(map.some(item => item.url.endsWith("/acceptable-use")));
  });
  await check("development and unapproved sites remain blocked, even with indexing requested on loopback", () => {
    const local: NodeJS.ProcessEnv = { NODE_ENV: "development", APP_ORIGIN: "http://127.0.0.1:3000", SEO_INDEXING_ENABLED: "true" };
    assert.equal(siteConfiguration(local).indexable, false);
    assert.deepEqual(siteMap(local), []); assert.equal((robotRules(local).rules as { disallow: string }).disallow, "/");
    assert.equal(siteConfiguration({ ...publicEnv, SEO_INDEXING_ENABLED: "false" }).indexable, false);
    assert.equal(siteConfiguration({ ...publicEnv, SEO_INDEXING_ENABLED: undefined }).indexable, false);
    for (const url of ["https://127.0.0.2", "https://10.0.0.1", "https://192.168.0.1", "https://[::ffff:7f00:1]", "https://localhost.", "https://preview.localhost", "https://preview.internal", "https://preview.test", "https://preview.invalid"])
      assert.equal(siteConfiguration({ ...publicEnv, APP_ORIGIN: url }).indexable, false, url);
  });
  await check("invalid origins cannot inject canonical credentials, paths or query strings", () => {
    for (const url of ["https://user:secret@example.test", "https://example.test/path", "https://example.test/?token=secret", "https://example.test/#fragment", "javascript:alert(1)"])
      assert.throws(() => siteConfiguration({ ...publicEnv, APP_ORIGIN: url }));
    assert.throws(() => siteConfiguration({ NODE_ENV: "production" }));
  });
  await check("private path boundaries cover redirects, API and nested pages without blocking public models", () => {
    for (const path of ["/dashboard", "/dashboard/api-keys", "/admin/providers", "/api/payments/id/status", "/v1/chat/completions", "/playground", "/login", "/register", "/design-system"])
      assert(privatePath(path));
    for (const path of ["/", "/models", "/administer", "/privacy", "/terms"]) assert.equal(privatePath(path), false);
  });
  await check("contact configuration excludes URL/header injection and never invents missing identity", () => {
    assert.deepEqual(siteContact({}), { operatorName: null, email: null });
    for (const value of ["mailto:test@example.test", "test@example.test?subject=inject", "test@example.test\r\nBcc:other@example.test", "javascript:alert(1)"])
      assert.equal(siteContact({ SITE_CONTACT_EMAIL: value }).email, null);
    assert.equal(siteContact({ SITE_CONTACT_EMAIL: "contact@example.test" }).email, "contact@example.test");
  });
  const databaseUrl = process.env.DATABASE_URL_TEST;
  assert(databaseUrl, "Isolated test database is required.");
  const database = new URL(databaseUrl);
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/aihub_auth_test" && databaseUrl !== process.env.DATABASE_URL);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3123"], {
    env: { ...process.env, ...publicEnv, DATABASE_URL: databaseUrl, SITE_OPERATOR_NAME: "", SITE_CONTACT_EMAIL: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", DEEPSEEK_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  server.stdout?.resume(); server.stderr?.resume();
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("SEO test server exited.");
    try { const response = await request("/favicon.ico"); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert(ready, "SEO test server did not become ready.");
  for (const path of ["/", "/models", "/pricing", "/docs", ...Object.keys(legalDocuments)]) {
    await check(`production HTML: ${path} title, canonical, OG and Twitter`, async () => {
      const response = await request(path); assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /<title>[^<]*Token Depot[^<]*<\/title>/);
      const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
      assert(canonical, `Missing canonical on ${path}`);
      assert.equal(new URL(canonical).href, new URL(path, publicEnv.APP_ORIGIN).href);
      assert(html.includes('property="og:description"')); assert(html.includes('name="twitter:card" content="summary_large_image"'));
      assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, `${path} needs one primary heading`);
      assert(html.includes('class="skip-link"'), `${path} needs skip navigation`);
      assert(html.includes('name="theme-color"') && html.includes('(prefers-color-scheme: dark)'));
      assert(!html.includes('rel="canonical" href="http://attacker'));
      assert(response.headers.get("Content-Security-Policy")?.includes("'nonce-"), "SEO must retain nonce CSP.");
      if (path in legalDocuments) {
        const document = legalDocuments[path as keyof typeof legalDocuments];
        assert(html.includes(document.title)); assert(html.includes("上线审阅稿")); assert(html.includes('lang="zh-CN"'));
      }
      if (path === "/contact") { assert(html.includes("当前没有可受理消息的公开邮箱")); assert(!html.includes("mailto:")); }
    });
  }
  await check("served XML and robots match the configured public origin and exclude private routes", async () => {
    const xml = await (await request("/sitemap.xml")).text(); assert.equal((xml.match(/<loc>/g) ?? []).length, 9);
    assert(xml.includes(`${publicEnv.APP_ORIGIN}/terms`)); assert(!xml.includes("/dashboard")); assert(!xml.includes("<lastmod>"));
    const robots = await (await request("/robots.txt")).text();
    assert(robots.includes("Disallow: /api")); assert(robots.includes(`Sitemap: ${publicEnv.APP_ORIGIN}/sitemap.xml`));
  });
  await check("private HTML and unauthenticated redirects carry noindex headers", async () => {
    for (const path of ["/login", "/register", "/dashboard", "/admin", "/playground", "/api/admin/users"]) {
      const response = await request(path);
      assert(response.headers.get("X-Robots-Tag")?.includes("noindex"), path);
      if (response.status === 200) { const html = await response.text(); assert.match(html, /name="robots" content="noindex/); }
    }
  });
  await check("real favicon and social image are served with correct media types", async () => {
    for (const [path, type] of [["/favicon.ico", "image/"], ["/icon.png", "image/png"], ["/social/token-depot.png", "image/png"], ["/apple-icon.png", "image/png"]]) {
      const response = await request(path); assert.equal(response.status, 200); assert(response.headers.get("Content-Type")?.startsWith(type));
      assert((await response.arrayBuffer()).byteLength > 100);
    }
  });
  await check("documentation code is present and highlighted without client JavaScript", async () => {
    const html = await (await request("/docs")).text();
    assert(html.includes("hljs-keyword") && html.includes("AIHUB_API_KEY"));
    assert(html.includes('translate="no"') && html.includes('role="tabpanel"'));
    for (const language of ["bash", "javascript", "python"]) assert(html.includes(`language-${language}`));
  });
  await check("self-hosted fonts preload and hashed assets retain immutable caching", async () => {
    const page = await request("/"), html = await page.text();
    const fontLinks = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes('rel="preload"') && tag.includes('as="font"'));
    // React/Next may emit resource hints as HTTP Link headers or HTML elements.
    const paths = [...fontLinks.map(tag => tag.match(/href="([^"]+)"/)?.[1]),
      ...(page.headers.get("Link") ?? "").split(",").filter(link => /rel="?preload"?/.test(link) && /as="?font"?/.test(link)).map(link => link.match(/<([^>]+)>/)?.[1])];
    const fontPaths = [...new Set(paths.filter((path): path is string => !!path))];
    assert(fontPaths.length >= 2, "Geist Sans and Mono should be preloaded");
    for (const path of fontPaths) {
      const asset = new URL(path, origin);
      assert(asset.origin === origin && asset.pathname.startsWith("/_next/static/media/") && asset.pathname.endsWith(".woff2"));
      const response = await request(path); assert.equal(response.status, 200);
      assert(response.headers.get("Cache-Control")?.includes("immutable"));
    }
  });
  console.log(`SEO and legal-page checks: ${passed} passed. No production data or live provider requests were used.`);
}
async function run() {
  try { await main(); } catch (error) { console.error(`FAIL ${error instanceof Error ? error.message : "SEO verification failed"}`); process.exitCode = 1; }
  finally { if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]); } }
}
void run();
