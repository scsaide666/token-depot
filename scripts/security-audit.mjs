import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { config } from "dotenv";

// Public package names/versions only go to Google's OSV API. Credentials never do.
config({ path: ".env.local", quiet: true }); config({ quiet: true });
const root = process.cwd(), lockBytes = readFileSync(resolve(root, "package-lock.json"));
const lock = JSON.parse(lockBytes.toString("utf8")), versions = new Map();
for (const [path, record] of Object.entries(lock.packages ?? {})) {
  if (!path || !record.version) continue;
  const name = record.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
  if (!name || !record.version || record.link) throw new Error("Unsupported lockfile entry; manual review is required.");
  const key = `${name}@${record.version}`;
  if (!versions.has(key)) versions.set(key, { name, version: record.version, paths: [] });
  versions.get(key).paths.push(path);
}
const packages = [...versions.values()];
const outputArg = process.argv.find(value => value.startsWith("--output="));
const output = resolve(root, outputArg?.slice(9) ?? "docs/security-dependency-audit.json");
const report = { auditedAt: new Date().toISOString(), database: "https://osv.dev", lockfileSha256: createHash("sha256").update(lockBytes).digest("hex"),
  packageVersions: packages.length, scope: "Entire lockfile, including development and optional dependencies", vulnerabilities: [],
  checks: { onlineDatabase: false, clientArtifacts: false, publicEnvironment: false, source: false }, status: "INCOMPLETE" };
async function osv(path, body) {
  const response = await fetch(`https://api.osv.dev/v1/${path}`, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", "User-Agent": "AIHub-local-security-audit" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error("Security database unavailable.");
  const text = await response.text();
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error("Security database response too large.");
  return JSON.parse(text);
}
function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : entry.isFile() ? [resolve(directory, entry.name)] : []);
}
async function main() {
  const matches = new Map();
  for (let offset = 0; offset < packages.length; offset += 100) {
    let pending = packages.slice(offset, offset + 100).map(pkg => ({ pkg, pageToken: undefined })), pages = 0;
    while (pending.length) {
      if (++pages > 50) throw new Error("Security database pagination did not complete.");
      const response = await osv("querybatch", { queries: pending.map(({ pkg, pageToken }) => ({ package: { name: pkg.name, ecosystem: "npm" }, version: pkg.version, ...(pageToken ? { page_token: pageToken } : {}) })) });
      if (!Array.isArray(response.results) || response.results.length !== pending.length) throw new Error("Incomplete security database response.");
      const next = [];
      for (const [index, result] of response.results.entries()) {
        if (!result || typeof result !== "object" || result.vulns !== undefined && !Array.isArray(result.vulns)) throw new Error("Invalid advisory response.");
        for (const vulnerability of result.vulns ?? []) {
          if (typeof vulnerability.id !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(vulnerability.id)) throw new Error("Invalid advisory response.");
          if (!matches.has(vulnerability.id)) matches.set(vulnerability.id, []);
          const affected = matches.get(vulnerability.id), pkg = pending[index].pkg;
          if (!affected.some(value => value.name === pkg.name && value.version === pkg.version)) affected.push(pkg);
        }
        if (result.next_page_token !== undefined) {
          if (typeof result.next_page_token !== "string" || result.next_page_token.length > 16384) throw new Error("Invalid pagination response.");
          if (result.next_page_token) next.push({ pkg: pending[index].pkg, pageToken: result.next_page_token });
        }
      }
      pending = next;
    }
  }
  for (const [id, affected] of matches) {
    const data = await osv(`vulns/${encodeURIComponent(id)}`);
    if (data.withdrawn) continue;
    report.vulnerabilities.push({ id, aliases: data.aliases ?? [], summary: data.summary, severity: data.database_specific?.severity ?? "UNKNOWN",
      severityVectors: data.severity ?? [], references: data.references ?? [], affected, ranges: data.affected?.map(item => ({ package: item.package, ranges: item.ranges })) ?? [] });
  }
  report.checks.onlineDatabase = true;
  for (const name of Object.keys(process.env)) if (name.startsWith("NEXT_PUBLIC_") && /KEY|TOKEN|SECRET|PASSWORD|DATABASE|REDIS/i.test(name) && process.env[name]) throw new Error("Sensitive public environment variable configured.");
  report.checks.publicEnvironment = true;
  for (const directory of ["app", "components", "lib"]) for (const file of files(resolve(root, directory))) {
    if (!/\.(tsx?|m?js)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (/\$(?:query|execute)RawUnsafe\b|dangerouslySetInnerHTML/.test(text)) throw new Error(`Unsafe source primitive requires review: ${relative(root, file)}`);
  }
  report.checks.source = true;
  if (!process.argv.includes("--skip-bundle")) {
    const artifacts = files(resolve(root, ".next/static"));
    if (!artifacts.length) throw new Error("Build client artifacts before auditing them.");
    const secrets = Object.entries(process.env).filter(([name, value]) => /(?:API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|REDIS_URL)$/.test(name) && value && value.length >= 16).map(([, value]) => value);
    for (const [name, value] of Object.entries(process.env)) if (name.endsWith("_PRIVATE_KEY_PATH") || name.endsWith("_API_V3_KEY_PATH")) {
      if (value && existsSync(value)) { const key = readFileSync(value, "utf8").trim(); if (key.length >= 16) secrets.push(key); }
    }
    const encodings = secrets.flatMap(value => [value, encodeURIComponent(value), Buffer.from(value).toString("base64"), JSON.stringify(value).slice(1, -1)]);
    for (const file of [...artifacts, ...files(resolve(root, "public"))]) {
      const content = readFileSync(file);
      if (encodings.some(secret => content.includes(Buffer.from(secret))) || /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(content.toString("utf8"))) throw new Error(`Credential detected in client artifact: ${relative(root, file)}`);
    }
    report.checks.clientArtifacts = true;
  }
  report.status = report.vulnerabilities.length ? "VULNERABILITIES_FOUND" : process.argv.includes("--skip-bundle") ? "DEPENDENCIES_PASS_CLIENT_NOT_CHECKED" : "PASS";
  console.log(JSON.stringify({ status: report.status, packageVersions: packages.length, vulnerabilities: report.vulnerabilities.map(({ id, severity, affected }) => ({ id, severity, packages: affected.map(({ name, version }) => `${name}@${version}`) })), checks: report.checks }));
  if (report.vulnerabilities.length) process.exitCode = 1;
}
try { await main(); } catch { report.status = "INCOMPLETE"; console.error("Security audit could not complete. No credentials or raw error data were printed."); process.exitCode = 1; }
finally { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); }
