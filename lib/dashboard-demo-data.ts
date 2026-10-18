export { dailyUsage as dashboardDailyUsage, recentRequests as dashboardRecentRequests } from "./home-demo-data";

export const dashboardBalance = "¥42.85";
export const dashboardDateRange = "Sep 29 – Oct 5, 2026";

export const overviewMetrics = [
  { label: "Balance", value: dashboardBalance },
  { label: "Requests", value: "12,842" },
  { label: "Tokens", value: "8.42M" },
  { label: "Spend", value: "¥57.15" },
] as const;
