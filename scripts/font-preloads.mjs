import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

// Match the installed, pinned Next webpack font loader's content-hash naming.
// The postbuild check prevents a framework/font upgrade from shipping stale hints.
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), process.argv.includes("--dev"), { info() {}, error() { throw new Error("Unable to load the font build environment."); } });
const { interpolateName } = require("next/dist/compiled/loader-utils3");
const fonts = [
  ["node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", "-s"],
  ["node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2", ""],
];
const deploymentQuery = process.env.NEXT_DEPLOYMENT_ID ? `?dpl=${process.env.NEXT_DEPLOYMENT_ID}` : "";
const urls = fonts.map(([file, sizeAdjust]) => `/_next/${interpolateName({ resourcePath: file }, `static/media/[hash]${sizeAdjust}.p.woff2`, { context: process.cwd(), content: readFileSync(file) })}${deploymentQuery}`);
const output = "lib/font-preloads.json";
if (process.argv.includes("--verify")) {
  const declared = JSON.parse(readFileSync(output, "utf8"));
  const css = readdirSync(".next/static/css").map(file => readFileSync(`.next/static/css/${file}`, "utf8")).join("\n");
  const cssUrls = new Set([...css.matchAll(/url\((?:["']([^"']+)["']|([^)]*))\)/g)].map(match => match[1] ?? match[2]));
  if (JSON.stringify(declared) !== JSON.stringify(urls) || urls.some(url => !existsSync(`.next/${new URL(url, "https://aihub.invalid").pathname.slice("/_next/".length)}`) || !cssUrls.has(url))) {
    throw new Error("Font preload URLs no longer match emitted assets. Review the installed Next font loader and root font declarations.");
  }
  console.log("Verified two self-hosted font preload URLs against production CSS and assets.");
} else {
  const content = `${JSON.stringify(urls, null, 2)}\n`;
  if (!existsSync(output) || readFileSync(output, "utf8") !== content) writeFileSync(output, content);
  console.log("Prepared two self-hosted font resource hints.");
}
