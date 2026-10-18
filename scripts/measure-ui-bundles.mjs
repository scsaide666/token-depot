import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

const label = process.argv[2];
if (!["before", "after"].includes(label)) throw new Error("Use before or after.");
const routes = ["", "docs", "models", "pricing", "dashboard", "dashboard/models", "dashboard/usage", "playground"];
const metrics = {};
for (const route of routes) {
  const file = `.next/server/app/${route ? `${route}/` : ""}page_client-reference-manifest.js`;
  const manifest = readFileSync(file, "utf8");
  const files = [...new Set(manifest.match(/static\/chunks\/[^"\\]+\.js/g) ?? [])].sort();
  metrics[`/${route}`] = {
    files,
    rawBytes: files.reduce((total, path) => total + statSync(`.next/${path}`).size, 0),
    gzipBytes: files.reduce((total, path) => total + gzipSync(readFileSync(`.next/${path}`)).length, 0),
  };
}
const report = {
  measuredAt: new Date().toISOString(),
  buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
  node: process.version,
  method: "Unique JavaScript chunks referenced by each production route client manifest, including shared chunks. Not browser transfer, Lighthouse or Core Web Vitals.",
  routes: metrics,
};
const directory = resolve("../../work/ux-performance");
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/bundles-${label}.json`, JSON.stringify(report, null, 2));
console.table(Object.fromEntries(Object.entries(metrics).map(([route, value]) => [route, { files: value.files.length, rawBytes: value.rawBytes, gzipBytes: value.gzipBytes }])));
