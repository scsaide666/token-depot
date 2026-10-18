export type AnalyticsRange = "24H" | "7D" | "30D";
export type AnalyticsMetric = "requests" | "tokens" | "spend";
export type RequestStatus = "PENDING" | "SUCCESS" | "FAILED";
export type UsageQuery = { range: AnalyticsRange; modelId?: string; apiKeyId?: string; status?: RequestStatus; page: number; pageSize: number };
export type PageQuery = { page: number; pageSize: number };
export type PageInfo = { page: number; pageSize: number; total: number; totalPages: number };
export type UsageStats = { requests: string; tokens: string; spend: string; averageLatencyMs: number | null; errorRate: string; failedRequests: string; pendingRequests: string };
export type AnalyticsPoint = { date: string; label: string; requests: string; tokens: string; spend: string };
export type RequestRecord = {
  id: string; requestId: string; model: string; apiKeyName: string;
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  cost: string | null; latencyMs: number; status: RequestStatus; createdAt: string;
};
export type FilterOption = { value: string; label: string };
export type OverviewData = {
  availableBalance: string; reservedBalance: string; month: UsageStats; monthSpend: string;
  range: AnalyticsRange; start: string; end: string; points: AnalyticsPoint[]; recentRequests: RequestRecord[];
};
export type UsageData = {
  query: UsageQuery; start: string; end: string; stats: UsageStats; points: AnalyticsPoint[];
  requests: RequestRecord[]; pagination: PageInfo; filters: { models: FilterOption[]; apiKeys: FilterOption[] };
};
export type TransactionRecord = { id: string; createdAt: string; type: "USAGE" | "RECHARGE" | "ADMIN_ADJUSTMENT"; amount: string; balanceAfter: string; description: string };
export type BillingData = {
  availableBalance: string; reservedBalance: string; monthSpend: string; lifetimeSpend: string;
  transactions: TransactionRecord[]; pagination: PageInfo;
  recharges: RechargeRecord[]; rechargePagination: PageInfo; paymentOptions: PaymentOptions;
};
import type { PaymentOptions, RechargeRecord } from "./payment-types";
