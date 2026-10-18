import type { PublicModel } from "./model-types";

export type PlaygroundModel = PublicModel & {
  parameters: { temperature: { min: number; max: number; default: number } | null; maxOutputTokens: number; defaultOutputTokens: number };
};
export type PlaygroundMessage = { id: string; role: "user" | "assistant"; content: string; state?: "streaming" | "complete" | "stopped" | "failed" };
export type PlaygroundStats = {
  requestId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  actualCost: string | null;
  currency: "CNY";
  errorCode: string | null;
  availableBalance: string;
  balanceDisplay: string;
};
