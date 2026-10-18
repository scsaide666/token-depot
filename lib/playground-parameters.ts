import type { Model } from "@/generated/prisma/client";
import type { PlaygroundModel } from "./playground-types";
import { CHAT_LIMITS } from "./ai/types/limits";

export function playgroundParameters(model: Pick<Model, "provider" | "providerModel" | "contextWindow">): PlaygroundModel["parameters"] {
  // Called only with server-side model records. Reasoning models can reject
  // sampling controls, so omit these rather than send an unsupported parameter.
  const reasoning = /reasoner|reasoning|thinking|^o[134](?:-|$)|^gpt-5/i.test(model.providerModel);
  const temperature = model.provider === "OPENAI" || reasoning ? null : { min: 0, max: model.provider === "ANTHROPIC" ? 1 : 2, default: 0.7 };
  const maxOutputTokens = Math.max(1, Math.min(4096, CHAT_LIMITS.outputTokens, model.contextWindow - 128));
  return { temperature, maxOutputTokens, defaultOutputTokens: Math.min(512, maxOutputTokens) };
}
