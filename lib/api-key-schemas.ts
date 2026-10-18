import { z } from "zod";

export const apiKeyNameSchema = z.string().trim().min(1, "Enter a name for your API key.").max(64, "Use no more than 64 characters.");
export const apiKeyNameBody = z.object({ name: apiKeyNameSchema }).strict();
export const apiKeyEmptyBody = z.object({}).strict();
export const apiKeyIdSchema = z.uuid();
