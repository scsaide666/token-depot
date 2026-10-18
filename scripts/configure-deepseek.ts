import { readFile, writeFile } from "node:fs/promises";
import { config, parse } from "dotenv";
import { getDb } from "../lib/server/db";

// Explicit local setup, never imported by a route or the browser.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

const pausedProviders = ["OPENAI", "ANTHROPIC", "GOOGLE"] as const;
const pausedSecrets = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const;
let stage = "validate local configuration";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/aihub") {
    throw new Error("Local development database required.");
  }
  const original = await readFile(".env.local", "utf8");
  const privateConfig = parse(original);
  if (!privateConfig.DEEPSEEK_API_KEY?.trim() ||
      (privateConfig.DEEPSEEK_BASE_URL || "https://api.deepseek.com") !== "https://api.deepseek.com") {
    throw new Error("Configure DeepSeek privately first.");
  }
  let updated = original;
  for (const name of pausedSecrets) {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, "gm");
    updated = pattern.test(updated)
      ? updated.replace(pattern, `${name}=""`)
      : `${updated.trimEnd()}\n${name}=""\n`;
  }

  const db = getDb();
  try {
    stage = "configure model catalog";
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.model.findUnique({ where: { slug: "deepseek-flash" } });
      if (existing && (existing.provider !== "DEEPSEEK" || existing.providerModel !== "deepseek-flash")) {
        throw new Error("Model slug is already routed elsewhere.");
      }
      const model = existing
        ? await tx.model.update({ where: { id: existing.id }, data: { enabled: true } })
        : await tx.model.create({ data: {
          slug: "deepseek-flash", name: "DeepSeek Flash", provider: "DEEPSEEK",
          providerModel: "deepseek-flash",
          description: "A fast, versatile model for coding, everyday tasks and long text conversations.",
          contextWindow: 1000000,
          // Fixed CNY baseline, based on the official peak/cache-miss rates.
          // Source and the off-peak/cache pricing limitation are documented.
          inputPricePerMillion: "2", outputPricePerMillion: "8", markupMultiplier: "1",
          enabled: true,
        } });
      const paused = await tx.model.updateMany({
        where: { provider: { in: [...pausedProviders] }, enabled: true }, data: { enabled: false },
      });
      return { slug: model.slug, pausedModels: paused.count, existingPricesPreserved: Boolean(existing) };
    });
    stage = "blank paused provider credentials";
    if (updated !== original) await writeFile(".env.local", updated, "utf8");
    for (const name of pausedSecrets) process.env[name] = "";
    console.log(JSON.stringify({ ...result, configuredProvider: "DEEPSEEK", pausedCredentialsBlank: true }));
  } finally {
    await db.$disconnect();
  }
}

void main().catch(() => {
  console.error(`DeepSeek setup failed during ${stage}; no configuration values were printed.`);
  process.exitCode = 1;
});
