import "server-only";
import type { ModelProvider, ProviderChannel } from "@/generated/prisma/client";
import { getProvider } from "./index";
import { GatewayError } from "../types";

export const envPrefix = { OPENAI: "OPENAI", ANTHROPIC: "ANTHROPIC", GOOGLE: "GEMINI", DEEPSEEK: "DEEPSEEK" } as const;
const origins = { OPENAI: "https://api.openai.com/v1", ANTHROPIC: "https://api.anthropic.com/v1", GOOGLE: "https://generativelanguage.googleapis.com/v1beta", DEEPSEEK: "https://api.deepseek.com" };
export function validEnvReference(provider: ModelProvider, value: string, kind: "API_KEY" | "BASE_URL") {
  return new RegExp(`^${envPrefix[provider]}(?:_[A-Z0-9]{1,40})?_${kind}$`).test(value);
}
export function channelAdapter(channel: Pick<ProviderChannel, "provider" | "apiKeyEnv" | "baseUrlEnv" | "timeoutMs">) {
  if (!validEnvReference(channel.provider, channel.apiKeyEnv, "API_KEY") || !validEnvReference(channel.provider, channel.baseUrlEnv, "BASE_URL")) throw unavailable();
  const primary = channel.baseUrlEnv === `${envPrefix[channel.provider]}_BASE_URL`;
  const baseUrl = process.env[channel.baseUrlEnv] || (primary ? origins[channel.provider] : undefined);
  if (!baseUrl) throw unavailable();
  return getProvider(channel.provider, { apiKey: process.env[channel.apiKeyEnv], baseUrl, timeoutMs: String(channel.timeoutMs) });
}
function unavailable() { return new GatewayError(503, "This model's provider is not configured.", "server_error", "provider_not_configured"); }
export function channelConfigured(channel: Pick<ProviderChannel, "provider" | "apiKeyEnv" | "baseUrlEnv" | "timeoutMs">) {
  try { channelAdapter(channel); return true; } catch { return false; }
}
export function channelDefaults() {
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
  };
  return { rpm: integer("PROVIDER_CHANNEL_RPM", 60, 1000000), tpm: integer("PROVIDER_CHANNEL_TPM", 200000, 1000000000),
    concurrency: integer("PROVIDER_CHANNEL_CONCURRENCY", 10, 1000), failureThreshold: integer("PROVIDER_FAILURE_THRESHOLD", 5, 1000) };
}
