import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { config } from "dotenv";
config({ quiet: true });
const database = new URL(process.env.DATABASE_URL_TEST ?? "");
assert(["localhost","127.0.0.1"].includes(database.hostname) && database.pathname === "/aihub_auth_test");
const origin = "http://127.0.0.1:3135";
const server = spawn(process.execPath, [".next/standalone/server.js"], { windowsHide: true, stdio: "ignore", env: {
  ...process.env, DATABASE_URL: database.href, APP_ORIGIN: "https://standalone.example.test",
  HOSTNAME: "127.0.0.1", PORT: "3135", SEO_INDEXING_ENABLED: "false", PAYMENTS_ENABLED: "false",
  OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: ""
}});
try {
  let ready = false;
  for (let i=0;i<100;i++) {
    try { const r = await fetch(origin+"/login", { signal: AbortSignal.timeout(1000) }); if(r.ok) { ready=true; break; } } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert(ready, "Standalone runtime must start");
  for (const path of ["/","/login","/register","/models","/pricing","/docs","/design-system",
    "/terms","/privacy","/refund-policy","/acceptable-use","/contact"]) {
    const response = await fetch(origin+path, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status,200,path);
    console.log("PASS standalone " + path);
  }
  const admin = await fetch(origin+"/admin", { redirect:"manual", signal:AbortSignal.timeout(10000) });
  assert([307,401,403].includes(admin.status)); console.log("PASS standalone private route protected");
  const api = await fetch(origin+"/v1/chat/completions", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({model:"nonexistent",messages:[{role:"user",content:"test"}]}) });
  assert.equal(api.status,401); console.log("PASS standalone gateway rejects missing key");
} finally { server.kill(); }

