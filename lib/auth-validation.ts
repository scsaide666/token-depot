import { loginSchema, registerSchema, validationFields } from "./auth-schemas";

export type AuthMode = "login" | "register";
export type AuthValues = { name: string; email: string; password: string; confirmPassword: string };
export type AuthErrors = Partial<Record<keyof AuthValues, string>>;

export function validateEmail(email: string) {
  if (!email.trim()) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
  return undefined;
}

export function validateAuth(values: AuthValues, mode: AuthMode): AuthErrors {
  const parsed = mode === "register" ? registerSchema.safeParse(values) : loginSchema.safeParse({ email: values.email, password: values.password, rememberMe: false });
  return parsed.success ? {} : validationFields(parsed.error);
}

// A visual hint only. Registration requires eight characters, not a score.
export function passwordStrength(password: string) {
  if (!password) return { score: 0, label: "Use at least 8 characters." };
  if (password.length < 8 || !password.trim()) return { score: 1, label: "Weak" };
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (password.length >= 12 && variety >= 3) return { score: 4, label: "Strong" };
  if (password.length >= 12 || variety >= 3) return { score: 3, label: "Good" };
  return { score: 2, label: "Fair" };
}
