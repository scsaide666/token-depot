import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve("browser-results");
const summary = {};
for (const mode of ["mobile", "desktop"]) {
  const source = path.join(outputDir, `lighthouse-${mode}.report.json`);
  let report;
  try { report = JSON.parse(await readFile(source, "utf8")); }
  catch { throw new Error(`Missing or invalid Lighthouse report: ${source}`); }
  const score = (key) => report.categories?.[key]?.score == null ? null : Math.round(report.categories[key].score * 100);
  const metric = (key) => {
    const audit = report.audits?.[key];
    return audit ? { value: audit.numericValue ?? null, display: audit.displayValue ?? null } : null;
  };
  summary[mode] = {
    source, requestedUrl: report.requestedUrl ?? null, finalUrl: report.finalDisplayedUrl ?? null,
    lighthouseVersion: report.lighthouseVersion ?? null,
    scores: { performance: score("performance"), accessibility: score("accessibility"), bestPractices: score("best-practices"), seo: score("seo") },
    metrics: {
      LCP: metric("largest-contentful-paint"),
      CLS: metric("cumulative-layout-shift"),
      TBT: metric("total-blocking-time"),
      INP: metric("interaction-to-next-paint"),
    },
    runtimeError: report.runtimeError?.message ?? null,
    runWarnings: report.runWarnings ?? [],
  };
  if (summary[mode].runtimeError) process.exitCode = 1;
}
const destination = path.join(outputDir, "lighthouse-summary.json");
await writeFile(destination, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`Summary: ${destination}`);
console.log("INP is a field metric; a null lab value is not a passing INP result.");
