import type { PageInfo } from "./analytics-types";
import type { Provider } from "./model-types";
export type HealthWindow = "5m" | "1h" | "24h";
export type ChannelStats = { requests: string; successes: string; errors: string; averageLatency: number | null; successRate: number | null; errorRate: number | null; cost: string; unknownCosts: string };
export type ChannelRecord = {
  id: string; code: string; name: string; provider: Provider; enabled: boolean; priority: number; weight: number;
  apiKeyEnv: string; baseUrlEnv: string; timeoutMs: number; rpm: number; tpm: number; concurrency: number;
  failureThreshold: number; cooldownMs: number; idempotentRequests: boolean; configured: boolean;
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN"; openedUntil: string | null; rateLimitedUntil: string | null;
  health: "Healthy" | "Degraded" | "Offline"; windows: Record<HealthWindow, ChannelStats>;
};
export type BindingRecord = { id: string; modelId: string; modelSlug: string; providerModel: string; compatible: boolean; contextWindow: number; inputPricePerMillion: string; outputPricePerMillion: string; enabled: boolean; preferred: boolean };
export type AttemptRecord = { id: string; requestId: string; attemptNumber: number; status: string; executionState: string; costStatus: string; providerCost: string | null; latencyMs: number; errorCode: string | null; createdAt: string };
export type ProviderPageData = { channels: ChannelRecord[]; pagination: PageInfo; query: { page: number; pageSize: number; window: HealthWindow; search?: string; provider?: Provider } };
