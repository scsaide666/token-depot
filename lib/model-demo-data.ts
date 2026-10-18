import { modelCatalog } from "./home-demo-data";

export const modelProviders = ["All", "OpenAI", "Anthropic", "Google", "DeepSeek"] as const;
export type ModelProvider = Exclude<(typeof modelProviders)[number], "All">;
export type ModelProviderFilter = (typeof modelProviders)[number];
export type ModelStatus = "Available" | "Limited" | "Offline";

export type DemoModel = {
  id: string;
  provider: ModelProvider;
  name: string;
  description: string;
  context: string;
  input: string;
  output: string;
  status: ModelStatus;
};

// Prices reuse the homepage snapshot. IDs and availability are static UI examples.
const catalogDetails: Record<(typeof modelCatalog)[number]["model"], Pick<DemoModel, "id" | "provider" | "description" | "status">> = {
  "GPT-5.4": { id: "gpt-5.4", provider: "OpenAI", description: "Reasoning, coding and everyday tasks in one versatile model.", status: "Available" },
  "Claude Sonnet 5.5": { id: "claude-sonnet-5-5", provider: "Anthropic", description: "Thoughtful reasoning and coding with a long context window.", status: "Available" },
  "Gemini 3.1 Flash-Lite": { id: "gemini-3.1-flash-lite", provider: "Google", description: "Fast, efficient responses for high-volume applications.", status: "Available" },
  "DeepSeek V4.1 Flash": { id: "deepseek-v4.1-flash", provider: "DeepSeek", description: "Efficient reasoning and code generation for everyday workloads.", status: "Limited" },
};

export const dashboardModels: DemoModel[] = [
  ...modelCatalog.map((model) => ({
    ...catalogDetails[model.model],
    name: model.model,
    context: model.context,
    input: model.input,
    output: model.output,
  })),
  { id: "gpt-5", provider: "OpenAI", name: "GPT-5", description: "Advanced reasoning and general-purpose model.", context: "400K tokens", input: "¥1.25", output: "¥10.00", status: "Offline" },
  { id: "gpt-5-mini", provider: "OpenAI", name: "GPT-5 Mini", description: "Compact reasoning for focused tasks and lower-cost workflows.", context: "400K tokens", input: "¥0.25", output: "¥2.00", status: "Limited" },
];

export function filterModels(search: string, provider: ModelProviderFilter) {
  const query = search.trim().toLowerCase();
  return dashboardModels.filter((model) =>
    (provider === "All" || model.provider === provider) &&
    `${model.name} ${model.provider} ${model.id} ${model.description}`.toLowerCase().includes(query)
  );
}
