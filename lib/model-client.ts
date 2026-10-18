import type { AdminModelRecord } from "./model-types";

export class ModelRequestError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string[]> = {}) { super(message); }
}
export async function modelRequest(path: string, method = "GET", body?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, { method, cache: "no-store", signal,
    ...(method !== "GET" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result: { models?: AdminModelRecord[]; model?: AdminModelRecord; error?: string; fieldErrors?: Record<string, string[]> } = await response.json();
  if (response.status === 401) window.location.replace("/login");
  if (!response.ok) throw new ModelRequestError(result.error ?? "Unable to save this model. Please try again.", result.fieldErrors);
  return result;
}
