import { config } from "dotenv";
import { getDb } from "../lib/server/db";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const db = getDb();
  try {
    const models = await db.model.findMany({
      select: {
        slug: true, name: true, provider: true, providerModel: true, enabled: true,
        contextWindow: true, inputPricePerMillion: true, outputPricePerMillion: true,
        markupMultiplier: true,
      },
      orderBy: { createdAt: "asc" },
    });
    console.log(JSON.stringify({ models, credentials: Object.fromEntries(
      ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"].map(
        (name) => [name, Boolean(process.env[name]?.trim())],
      ),
    ) }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

void main().catch(() => { console.error("Provider inventory unavailable; configuration values were not printed."); process.exitCode = 1; });
