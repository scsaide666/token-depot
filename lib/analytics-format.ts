import type { AnalyticsMetric, AnalyticsRange } from "./analytics-types";

export const rangeOptions = [{ value: "24H", label: "24H" }, { value: "7D", label: "7D" }, { value: "30D", label: "30D" }] as const;
export const metricOptions = [{ value: "requests", label: "Requests" }, { value: "tokens", label: "Tokens" }, { value: "spend", label: "Spend" }] as const;
export const metricLabels = { requests: "Requests", tokens: "Token Usage", spend: "Spend" };

// Decimal strings are formatted directly. Even the smallest stored charge stays visible.
export function formatCny(value: string | null, signed = false) {
  if (value === null) return "—";
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const decimals = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${negative ? "−" : signed && /[1-9]/.test(value) ? "+" : ""}¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimals}`;
}
export function formatCount(value: string | number | null) {
  return value === null ? "—" : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function formatMetric(value: string, metric: AnalyticsMetric) { return metric === "spend" ? formatCny(value) : formatCount(value); }
export function requestDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
export function requestTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(value));
}
export function rangeLabel(range: AnalyticsRange) { return range === "24H" ? "Last 24 hours" : range === "7D" ? "Last 7 days" : "Last 30 days"; }
