import type { AdminModelRecord, Provider } from "./model-types";
import type { AnalyticsPoint, PageInfo } from "./analytics-types";

export type AdminDates = { from?: string; to?: string };
export type AdminPageQuery = { page: number; pageSize: number };
export type AdminUserQuery = AdminPageQuery & { search?: string; status?: "ACTIVE" | "SUSPENDED" };
export type AdminRequestQuery = AdminPageQuery & AdminDates & { userId?: string; modelId?: string; status?: "PENDING" | "SUCCESS" | "FAILED" };
export type AdminPaymentQuery = AdminPageQuery & AdminDates & { userId?: string; method?: "ALIPAY" | "WECHAT"; status?: "PENDING" | "PAID" | "FAILED" | "CLOSED" | "REFUNDED" };
export type AdminModelQuery = AdminPageQuery & AdminDates & { search?: string; provider?: Provider };
export type FinancialStats = { requests: string; tokens: string; revenue: string; providerCost: string; profit: string; unknownCosts: string };
export type AdminUserRecord = {
  id: string; name: string; email: string; balance: string; reservedBalance: string; availableBalance: string;
  lifetimeSpend: string; requests: string; status: "ACTIVE" | "SUSPENDED"; createdAt: string;
};
export type AdminRequestRecord = {
  id: string; requestId: string; user: { id: string; name: string; email: string }; model: string;
  inputTokens: number | null; outputTokens: number | null; userCost: string | null; providerCost: string | null; profit: string | null;
  latencyMs: number; status: "PENDING" | "SUCCESS" | "FAILED"; createdAt: string;
};
export type AdminPaymentRecord = {
  id: string; orderId: string; user: { id: string; name: string; email: string }; method: "ALIPAY" | "WECHAT";
  amount: string; status: "PENDING" | "PAID" | "FAILED" | "CLOSED" | "REFUNDED"; paidAt: string | null; createdAt: string;
};
export type AdminUsersData = { query: AdminUserQuery; users: AdminUserRecord[]; pagination: PageInfo };
export type AdminRequestsData = { query: AdminRequestQuery; requests: AdminRequestRecord[]; stats: FinancialStats; pagination: PageInfo };
export type AdminPaymentsData = { query: AdminPaymentQuery; payments: AdminPaymentRecord[]; pagination: PageInfo };
export type AdminModelsData = { query: AdminModelQuery; models: (AdminModelRecord & { stats: FinancialStats })[]; pagination: PageInfo };
export type AdminOverviewData = {
  query: AdminDates; from: string; to: string; today: FinancialStats; selected: FinancialStats;
  totalUsers: number; activeUsers: number; points: AnalyticsPoint[]; recentUsers: AdminUserRecord[]; recentRequests: AdminRequestRecord[];
};
