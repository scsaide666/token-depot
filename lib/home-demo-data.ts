export const dashboardMetrics = [
  { label: "Balance", value: "¥48.25" },
  { label: "Requests", value: "12,842" },
  { label: "Tokens", value: "8.42M" },
  { label: "Spend", value: "¥51.75" },
] as const;

export const dailyUsage = [
  { date: "Sep 29", requests: 1120 },
  { date: "Sep 30", requests: 1640 },
  { date: "Oct 1", requests: 1428 },
  { date: "Oct 2", requests: 2134 },
  { date: "Oct 3", requests: 1780 },
  { date: "Oct 4", requests: 2360 },
  { date: "Oct 5", requests: 2380 },
] as const;

export const recentRequests = [
  { id: "demo-004", model: "GPT-5.4", time: "Just now", tokens: "1,842", cost: "¥0.012" },
  { id: "demo-003", model: "Claude Sonnet 5.5", time: "2 min ago", tokens: "2,106", cost: "¥0.010" },
  { id: "demo-002", model: "Gemini 3.1 Flash-Lite", time: "4 min ago", tokens: "964", cost: "¥0.001" },
  { id: "demo-001", model: "DeepSeek V4.1 Flash", time: "6 min ago", tokens: "1,328", cost: "¥0.001" },
] as const;

// Illustrative catalog, not AIHub quotes. See README for sources and rate conditions.
export const modelCatalog = [
  { provider: "OpenAI", mark: "O", model: "GPT-5.4", context: "1.05M tokens", input: "¥2.50", output: "¥15.00" },
  { provider: "Claude", mark: "C", model: "Claude Sonnet 5.5", context: "1M tokens", input: "¥2.00", output: "¥10.00" },
  { provider: "Gemini", mark: "G", model: "Gemini 3.1 Flash-Lite", context: "1M tokens", input: "¥0.25", output: "¥1.50" },
  { provider: "DeepSeek", mark: "D", model: "DeepSeek V4.1 Flash", context: "1M tokens", input: "¥0.30", output: "¥1.20" },
] as const;
