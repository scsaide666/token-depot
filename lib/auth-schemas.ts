import { z } from "zod";

export const nameSchema = z.string().trim().min(1, "Enter your name.").max(80, "Use no more than 80 characters.");
const emailSchema = z.string().trim().toLowerCase().max(254, "Use no more than 254 characters.").pipe(z.email("Enter a valid email address."));
const passwordSchema = z.string().min(1, "Enter your password.").max(128, "Use no more than 128 characters.");

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema.min(8, "Use at least 8 characters for your password.").refine((value) => !!value.trim(), "Use a password that includes non-space characters."),
  confirmPassword: passwordSchema,
}).strict().refine((value) => value.password === value.confirmPassword, { message: "Passwords don’t match.", path: ["confirmPassword"] });

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema, rememberMe: z.boolean().default(false) }).strict();
export const profileSchema = z.object({ name: nameSchema }).strict();
export const logoutSchema = z.object({ all: z.boolean().default(false) }).strict();

export function validationFields(error: z.ZodError) {
  const result: Partial<Record<"name" | "email" | "password" | "confirmPassword", string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === "name" || field === "email" || field === "password" || field === "confirmPassword") result[field] ??= issue.message;
  }
  return result;
}
