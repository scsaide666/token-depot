export type UsageRange = "24H" | "7D" | "30D";
export type UsageMetric = "requests" | "tokens" | "spend";

export type UsagePoint = {
  label: string;
  requests: number;
  tokens: number;
  spend: number;
};

export type UsageRequest = {
  id: string;
  date: string;
  time: string;
  model: string;
  apiKey: string;
  input: number;
  output: number;
  cost: number;
  latency: number;
  status: "Success" | "Failed";
};

const week: UsagePoint[] = [
  { label: "Sep 29", requests: 1200, tokens: 1800000, spend: 4.18 },
  { label: "Sep 30", requests: 1640, tokens: 2400000, spend: 5.57 },
  { label: "Oct 1", requests: 1428, tokens: 2100000, spend: 4.89 },
  { label: "Oct 2", requests: 2134, tokens: 3200000, spend: 7.45 },
  { label: "Oct 3", requests: 1780, tokens: 2600000, spend: 6.04 },
  { label: "Oct 4", requests: 2160, tokens: 3100000, spend: 7.23 },
  { label: "Oct 5", requests: 2140, tokens: 3200000, spend: 7.49 },
];

const day: UsagePoint[] = [
  { label: "00:00", requests: 180, tokens: 240000, spend: 0.56 },
  { label: "04:00", requests: 120, tokens: 180000, spend: 0.42 },
  { label: "08:00", requests: 260, tokens: 380000, spend: 0.89 },
  { label: "12:00", requests: 410, tokens: 620000, spend: 1.45 },
  { label: "16:00", requests: 620, tokens: 960000, spend: 2.25 },
  { label: "20:00", requests: 550, tokens: 820000, spend: 1.92 },
];

// Fixed demo dates keep the UI deterministic; the last seven days match the weekly view.
const month: UsagePoint[] = [
  ...Array.from({ length: 23 }, (_, index) => {
    const requests = 760 + ((index * 337) % 1100);
    const tokens = requests * (1300 + (index % 4) * 80);
    return {
      label: `Sep ${index + 6}`,
      requests,
      tokens,
      spend: Math.round(tokens * 0.00000233 * 100) / 100,
    };
  }),
  ...week,
];

export const usageRanges: Record<UsageRange, {
  points: UsagePoint[];
  period: string;
  startDate: string;
  latency: number;
}> = {
  "24H": { points: day, period: "Oct 5, 2026 · 4-hour intervals", startDate: "2026-10-05", latency: 826 },
  "7D": { points: week, period: "Sep 29 – Oct 5, 2026 · Daily", startDate: "2026-09-29", latency: 842 },
  "30D": { points: month, period: "Sep 6 – Oct 5, 2026 · Daily", startDate: "2026-09-06", latency: 867 },
};

export const usageMetricLabels: Record<UsageMetric, string> = {
  requests: "Requests", tokens: "Tokens", spend: "Spend",
};

export const usageRequests: UsageRequest[] = [
  { id: "req-01", date: "2026-10-05", time: "14:32", model: "gpt-5", apiKey: "Production", input: 1284, output: 438, cost: 0.018, latency: 720, status: "Success" },
  { id: "req-02", date: "2026-10-05", time: "14:28", model: "claude-sonnet-5.5", apiKey: "Production", input: 2140, output: 682, cost: 0.011, latency: 946, status: "Success" },
  { id: "req-03", date: "2026-10-05", time: "13:56", model: "gemini-3.1-flash-lite", apiKey: "Development", input: 864, output: 0, cost: 0, latency: 1240, status: "Failed" },
  { id: "req-04", date: "2026-10-05", time: "13:41", model: "deepseek-v4.1-flash", apiKey: "Development", input: 3260, output: 1206, cost: 0.002, latency: 812, status: "Success" },
  { id: "req-05", date: "2026-10-04", time: "18:12", model: "gpt-5", apiKey: "Production", input: 1920, output: 540, cost: 0.024, latency: 784, status: "Success" },
  { id: "req-06", date: "2026-10-04", time: "09:08", model: "gemini-3.1-flash-lite", apiKey: "Development", input: 628, output: 246, cost: 0.001, latency: 426, status: "Success" },
  { id: "req-07", date: "2026-10-03", time: "16:24", model: "claude-sonnet-5.5", apiKey: "Production", input: 1446, output: 512, cost: 0.008, latency: 902, status: "Success" },
  { id: "req-08", date: "2026-10-02", time: "11:42", model: "deepseek-v4.1-flash", apiKey: "Development", input: 780, output: 0, cost: 0, latency: 1680, status: "Failed" },
  { id: "req-09", date: "2026-10-01", time: "15:06", model: "gpt-5", apiKey: "Production", input: 2460, output: 864, cost: 0.032, latency: 816, status: "Success" },
  { id: "req-10", date: "2026-09-29", time: "10:18", model: "gemini-3.1-flash-lite", apiKey: "Development", input: 1102, output: 380, cost: 0.001, latency: 514, status: "Success" },
  { id: "req-11", date: "2026-09-24", time: "17:32", model: "claude-sonnet-5.5", apiKey: "Production", input: 2840, output: 712, cost: 0.013, latency: 1048, status: "Success" },
  { id: "req-12", date: "2026-09-18", time: "12:04", model: "gpt-5", apiKey: "Development", input: 640, output: 0, cost: 0, latency: 1426, status: "Failed" },
  { id: "req-13", date: "2026-09-08", time: "09:16", model: "deepseek-v4.1-flash", apiKey: "Development", input: 1840, output: 624, cost: 0.001, latency: 746, status: "Success" },
];

export const requestModels = [...new Set(usageRequests.map((request) => request.model))];
export const requestApiKeys = [...new Set(usageRequests.map((request) => request.apiKey))];

export function getUsageTotals(range: UsageRange) {
  return usageRanges[range].points.reduce((totals, point) => ({
    requests: totals.requests + point.requests,
    tokens: totals.tokens + point.tokens,
    spend: Math.round((totals.spend + point.spend) * 100) / 100,
  }), { requests: 0, tokens: 0, spend: 0 });
}

export function formatUsageValue(value: number, metric: UsageMetric, compact = false) {
  if (metric === "spend") return new Intl.NumberFormat("en-US", { style: "currency", currency: "CNY" }).format(value);
  if (metric === "tokens" || compact) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return value.toLocaleString("en-US");
}

export function formatRequestDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
