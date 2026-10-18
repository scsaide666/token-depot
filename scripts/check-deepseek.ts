import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("missing_config");
  if ((process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com") !== "https://api.deepseek.com") {
    throw new Error("unexpected_origin");
  }
  const response = await fetch("https://api.deepseek.com/models", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000), redirect: "error", cache: "no-store",
  });
  const body = await response.json() as { data?: { id?: unknown }[] };
  const models = response.ok && Array.isArray(body.data) ? body.data.flatMap((model) =>
    typeof model.id === "string" && /^[a-zA-Z0-9._-]{1,100}$/.test(model.id) && !model.id.includes(key)
      ? [model.id] : [],
  ) : [];
  console.log(JSON.stringify({ status: response.status, models }));
  if (!response.ok) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const cause = error instanceof Error ? error.cause : null;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  const allowed = ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED", "UND_ERR_CONNECT_TIMEOUT", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET"];
  console.error(JSON.stringify({ connection: "failed", code: typeof code === "string" && allowed.includes(code) ? code : "connection_error" }));
  process.exitCode = 1;
});
