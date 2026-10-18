import { z } from "zod";

const price = z.string().trim().regex(/^(0|[1-9]\d{0,13})(\.\d{1,8})?$/, "Use a non-negative CNY decimal with up to 14 whole and 8 fractional digits.");
const markup = z.string().trim().regex(/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/, "Use a decimal with up to 6 whole and 6 fractional digits.")
  .refine((value) => /[1-9]/.test(value), "Markup must be greater than zero.");

export const modelBody = z.object({
  slug: z.string().trim().min(1, "Enter a model ID.").max(100, "Use at most 100 characters.").regex(/^[a-z0-9][a-z0-9._-]*$/, "Use lowercase letters, numbers, dots, underscores or hyphens."),
  name: z.string().trim().min(1, "Enter a model name.").max(120),
  provider: z.enum(["OPENAI", "ANTHROPIC", "GOOGLE", "DEEPSEEK"]),
  providerModel: z.string().trim().min(1, "Enter the provider model ID.").max(200),
  description: z.string().trim().min(1, "Enter a description.").max(1000),
  contextWindow: z.number({ error: "Enter a positive whole number of tokens." }).int("Enter a whole number of tokens.").min(1, "Context must be at least one token.").max(2147483647, "Context cannot exceed 2,147,483,647 tokens."),
  inputPricePerMillion: price, outputPricePerMillion: price, markupMultiplier: markup,
  enabled: z.boolean(),
}).strict();
export const modelPatchBody = modelBody.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one model field.");
export const modelId = z.uuid();
export type ModelInput = z.infer<typeof modelBody>;
