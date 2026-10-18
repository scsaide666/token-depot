import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { createClient } from "redis";

const project = resolve(dirname(fileURLToPath(import.meta.url)), ".."), runtime = resolve(project, "../../work/redis");
const binary = join(runtime, "extracted/Memurai/memurai.exe"), configuration = join(runtime, "redis.conf"), privateFile = join(runtime, "local.json");
const action = process.argv[2] ?? "start", port = 56379;
if (process.platform !== "win32" || !["start", "stop", "status"].includes(action)) throw new Error("Use start, stop or status on Windows; otherwise configure REDIS_URL externally.");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
function powershell(script) { return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: "pipe", timeout: 120000 }); }
async function prepare() {
  mkdirSync(runtime, { recursive: true });
  if (!existsSync(binary)) {
    const archive = join(runtime, "Memurai-for-Redis-v8.2.0.msi");
    if (!existsSync(archive)) {
      const link = await fetch("https://www.memurai.com/api/request-download-link?version=windows-redis", { signal: AbortSignal.timeout(15000) });
      if (!link.ok) throw new Error("Official Memurai download is unavailable.");
      const body = await link.json(), url = new URL(body.url);
      if (url.protocol !== "https:" || url.hostname !== "download.memurai.com" || url.pathname !== "/Memurai-Developer/8.2.0/Memurai-for-Redis-v8.2.0.msi") throw new Error("Unexpected Memurai download; review the pinned runtime version.");
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body) throw new Error("Memurai download failed.");
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    }
    powershell(`$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath ${quote(archive)}
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Janea Systems') { throw 'Official runtime signature is invalid.' }
$args = '/a "' + ${quote(archive)} + '" /qn TARGETDIR="' + ${quote(join(runtime, "extracted"))} + '"'
$process = Start-Process -FilePath msiexec.exe -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw 'Runtime extraction failed.' }`);
  }
  // Local development/test edition only; no Windows service, firewall or PATH changes.
  const state = existsSync(privateFile) ? JSON.parse(readFileSync(privateFile, "utf8")) : { password: randomBytes(32).toString("hex"), ipSecret: randomBytes(32).toString("hex") };
  if (!/^[a-f0-9]{64}$/.test(state.password) || !/^[a-f0-9]{64}$/.test(state.ipSecret)) throw new Error("Invalid local Redis settings.");
  writeFileSync(privateFile, JSON.stringify(state), { mode: 0o600 });
  // Memurai rejects non-ASCII absolute paths in its config. Start-Process
  // below sets runtime as the working directory, so relative paths preserve
  // the existing AOF and log locations even when the project path is Unicode.
  writeFileSync(configuration, `bind 127.0.0.1\nprotected-mode yes\nport ${port}\nrequirepass ${state.password}\ndatabases 16\ndir "."\nlogfile "redis.log"\nmaxmemory 128mb\nmaxmemory-policy noeviction\nappendonly yes\nappendfsync everysec\nsave ""\n`, { mode: 0o600 });
  const settings = { REDIS_URL: `redis://:${state.password}@127.0.0.1:${port}/0`, REDIS_URL_TEST: `redis://:${state.password}@127.0.0.1:${port}/15`, IP_HASH_SECRET: state.ipSecret };
  const envPath = join(project, ".env"), previous = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  let addition = "";
  for (const [name, value] of Object.entries(settings)) if (!new RegExp(`^${name}=`, "m").test(previous)) addition += `${name}="${value}"\n`;
  if (addition) appendFileSync(envPath, `\n# Project-local Redis; credentials stay server-side.\n${addition}`, { mode: 0o600 });
  return state;
}
async function connect() {
  if (!existsSync(privateFile)) return undefined;
  const { password } = JSON.parse(readFileSync(privateFile, "utf8"));
  const client = createClient({ url: `redis://:${password}@127.0.0.1:${port}/0`, socket: { connectTimeout: 800, reconnectStrategy: false } });
  client.on("error", () => {});
  try { await client.connect(); await client.ping(); return client; } catch { if (client.isOpen) client.destroy(); return undefined; }
}
try {
  if (action === "start") {
    await prepare();
    let client = await connect();
    if (!client) {
      powershell(`Start-Process -FilePath ${quote(binary)} -ArgumentList ${quote('"' + configuration + '"')} -WorkingDirectory ${quote(runtime)} -WindowStyle Hidden`);
      for (let i = 0; i < 30 && !client; i++) { await new Promise((r) => setTimeout(r, 200)); client = await connect(); }
    }
    if (!client) throw new Error("Local Redis failed to start; inspect work/redis/redis.log without sharing credentials.");
    client.destroy(); console.log(`Local Redis-compatible service is running on 127.0.0.1:${port}. Private settings are in .env.`);
  } else {
    const client = await connect();
    if (action === "status") console.log(client ? `Local Redis is running on 127.0.0.1:${port}.` : "Local Redis is stopped.");
    else { if (client) await client.sendCommand(["SHUTDOWN", "NOSAVE"]).catch(() => {}); console.log("Local Redis stopped."); }
    if (client?.isOpen) client.destroy();
  }
} catch { console.error("Local Redis operation failed. Configuration and credentials were not printed."); process.exitCode = 1; }
