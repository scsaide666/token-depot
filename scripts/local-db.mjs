import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { config } from "dotenv";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(project, "../../work/postgresql");
const bin = join(runtime, "pgsql/bin");
const data = join(runtime, "data");
const port = 55432;
const envPath = join(project, ".env");
const bootstrapPath = join(runtime, "bootstrap.json");
const action = process.argv[2] ?? "start";
const download = "https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616";
if (process.platform !== "win32") throw new Error("This local runtime helper is for Windows. Configure DATABASE_URL for your PostgreSQL installation.");
if (!["start", "stop", "status"].includes(action)) throw new Error("Use start, stop or status.");

function run(executable, args, options = {}) {
  return execFileSync(join(bin, `${executable}.exe`), args, { windowsHide: true, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });
}
function isRunning() { try { run("pg_ctl", ["-D", data, "status"]); return true; } catch { return false; } }
function quotePowerShell(value) { return `'${value.replaceAll("'", "''")}'`; }

async function prepareBinaries() {
  if (existsSync(join(bin, "initdb.exe"))) return;
  mkdirSync(runtime, { recursive: true });
  const archive = join(runtime, "postgresql-windows.zip");
  if (!existsSync(archive)) {
    console.log("Downloading the official PostgreSQL Windows archive…");
    const response = await fetch(download);
    if (!response.ok || !response.body) throw new Error("PostgreSQL download failed.");
    const temporary = `${archive}.download`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    const { renameSync } = await import("node:fs");
    renameSync(temporary, archive);
  }
  // Extract only server files. Validate every target before writing it.
  const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = ${quotePowerShell(runtime)}
$zip = [System.IO.Compression.ZipFile]::OpenRead(${quotePowerShell(archive)})
try {
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -notmatch '^pgsql/(bin|lib|share)/') { continue }
    $target = [System.IO.Path]::GetFullPath((Join-Path $root $entry.FullName))
    if (-not $target.StartsWith($root + '\\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path is outside the runtime directory.' }
    if ($entry.FullName.EndsWith('/')) { [System.IO.Directory]::CreateDirectory($target) | Out-Null }
    else { [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null; [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true) }
  }
} finally { $zip.Dispose() }`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: "pipe", timeout: 120000 });
  console.log(run("postgres", ["--version"]).trim());
}

if (action === "status") { console.log(isRunning() ? "Local PostgreSQL is running on 127.0.0.1:55432." : "Local PostgreSQL is stopped."); }
else if (action === "stop") { if (isRunning()) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); console.log("Local PostgreSQL stopped."); }
else {
  await prepareBinaries();
  const initialized = existsSync(join(data, "PG_VERSION"));
  let bootstrap = existsSync(bootstrapPath) ? JSON.parse(readFileSync(bootstrapPath, "utf8")) : undefined;
  let superPassword = bootstrap?.password;
  const passwordFile = join(runtime, "bootstrap-password.txt");
  if (!initialized) {
    if (existsSync(envPath)) throw new Error("An existing .env was found. Keep it intact and configure your database explicitly before initializing a new cluster.");
    superPassword = randomBytes(32).toString("hex");
    bootstrap = { password: superPassword, appPassword: randomBytes(32).toString("hex") };
    writeFileSync(bootstrapPath, JSON.stringify(bootstrap), { mode: 0o600 });
    writeFileSync(passwordFile, `${superPassword}\n`, { mode: 0o600 });
    try { run("initdb", ["-D", data, "-U", "aihub_local", "--pwfile", passwordFile, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], { timeout: 60000 }); }
    finally { rmSync(passwordFile, { force: true }); }
  }
  if (!isRunning()) run("pg_ctl", ["-D", data, "-l", join(runtime, "postgresql.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], { timeout: 60000, stdio: "ignore" });
  if (superPassword && !existsSync(envPath)) {
    const appPassword = bootstrap.appPassword ?? randomBytes(32).toString("hex");
    writeFileSync(bootstrapPath, JSON.stringify({ password: superPassword, appPassword }), { mode: 0o600 });
    const sql = `DO $bootstrap$ BEGIN
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aihub_app') THEN
CREATE ROLE aihub_app WITH LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
END IF; END; $bootstrap$;
SELECT 'CREATE DATABASE aihub OWNER aihub_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aihub') \\gexec
SELECT 'CREATE DATABASE aihub_auth_test OWNER aihub_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aihub_auth_test') \\gexec
`;
    try { run("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", "aihub_local", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, env: { ...process.env, PGPASSWORD: superPassword } }); }
    catch { throw new Error("Local database provisioning failed. Initialization state is retained for retry; no credentials are printed."); }
    const url = `postgresql://aihub_app:${appPassword}@127.0.0.1:${port}/aihub?schema=public`;
    const testUrl = `postgresql://aihub_app:${appPassword}@127.0.0.1:${port}/aihub_auth_test?schema=public`;
    writeFileSync(envPath, `DATABASE_URL="${url}"\nDATABASE_URL_TEST="${testUrl}"\nAPP_ORIGIN="http://127.0.0.1:3000"\n`, { mode: 0o600 });
    rmSync(bootstrapPath, { force: true });
    console.log("Created development and isolated authentication test databases. Connection settings are in .env; credentials were not printed.");
  }
  config({ path: envPath, quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing. Local PostgreSQL is running, but app configuration is needed.");
  console.log("Local PostgreSQL is running on 127.0.0.1:55432. Run npm run db:migrate.");
}
