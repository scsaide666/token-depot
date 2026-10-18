import { readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const label = process.argv[2];
if (!["before", "after"].includes(label)) throw new Error("Use before or after.");
const out = {};
for (const route of ["dashboard", "dashboard/usage", "playground"]) {
  const manifest = readFileSync(`.next/server/app/${route}/page_client-reference-manifest.js`, "utf8");
  const paths = [...new Set(manifest.match(/static\/chunks\/[^"\\]+\.js/g) ?? [])];
  out[route] = { files: paths.length, rawBytes: paths.reduce((n, p) => n + statSync(`.next/${p}`).size, 0),
    gzipBytes: paths.reduce((n, p) => n + gzipSync(readFileSync(`.next/${p}`)).length, 0) };
}
// Manifest-referenced unique chunks incl. shared chunks; not measured browser transfer/LCP.
writeFileSync(`../../work/performance/frontend-${label}.json`, JSON.stringify(out, null, 2));
console.log(out);
