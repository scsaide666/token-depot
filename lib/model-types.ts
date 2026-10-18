export const providerNames = { OPENAI: "OpenAI", ANTHROPIC: "Anthropic", GOOGLE: "Google", DEEPSEEK: "DeepSeek" } as const;
export type Provider = keyof typeof providerNames;
export type ProviderName = (typeof providerNames)[Provider];
export const modelProviders = ["All", ...Object.values(providerNames)] as const;
export type ModelProviderFilter = "All" | ProviderName;

// Only sales prices and public metadata cross the public server/client boundary.
export type PublicModel = {
  slug: string; name: string; provider: ProviderName; description: string;
  contextWindow: number; inputPricePerMillion: string; outputPricePerMillion: string;
};
export type AdminModelRecord = PublicModel & {
  id: string; providerCode: Provider; providerModel: string; enabled: boolean;
  inputCostPerMillion: string; outputCostPerMillion: string; markupMultiplier: string;
  inputMarginPerMillion: string; outputMarginPerMillion: string;
  marginPercent: string | null; createdAt: string; updatedAt: string;
};

export function filterModels(catalog: PublicModel[], search: string, provider: ModelProviderFilter) {
  const query = search.trim().toLowerCase();
  return catalog.filter((model) => (provider === "All" || model.provider === provider) &&
    [model.name, model.slug, model.description, model.provider].some((value) => value.toLowerCase().includes(query)));
}

// Format decimal strings without converting prices to binary floating point.
export function modelPrice(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}
export function modelContext(value: number) { return value.toLocaleString("en-US"); }
export function modelApiExample(model: PublicModel) {
  return `curl https://YOUR_API_DOMAIN/v1/chat/completions \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: model.slug, messages: [{ role: "user", content: "Hello!" }] }, null, 2)}'`;
}
