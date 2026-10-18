"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestSignal } from "@/lib/client/request-signal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { passwordStrength, validateAuth, type AuthErrors, type AuthMode, type AuthValues } from "@/lib/auth-validation";
import type { FormResponse } from "@/lib/account-types";
import { AuthField } from "./auth-field";
import { ForgotPasswordDialog } from "./forgot-password-dialog";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const register = mode === "register";
  const [values, setValues] = useState<AuthValues>({ name: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<AuthErrors>({});
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const strength = passwordStrength(values.password);
  const fields: (keyof AuthValues)[] = register ? ["name", "email", "password", "confirmPassword"] : ["email", "password"];
  const empty = fields.some((field) => !values[field].trim());

  function update(field: keyof AuthValues, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    setMessage("");
    setErrors((current) => {
      const validation = validateAuth(next, mode);
      const updated = { ...current };
      if (current[field]) updated[field] = validation[field];
      if (field === "password" && current.confirmPassword) updated.confirmPassword = validation.confirmPassword;
      return updated;
    });
  }

  function blur(field: keyof AuthValues) {
    setErrors((current) => ({ ...current, [field]: validateAuth(values, mode)[field] }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || active.current) return;
    const validation = validateAuth(values, mode);
    setErrors(validation);
    const firstError = fields.find((field) => validation[field]);
    if (firstError) {
      (event.currentTarget.elements.namedItem(firstError) as HTMLInputElement)?.focus();
      return;
    }
    const form = event.currentTarget;
    setLoading(true);
    setMessage("");
    const controller = new AbortController(); active.current = controller;
    const request = requestSignal(30000, controller.signal);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(register ? values : { email: values.email, password: values.password, rememberMe: remember }) });
      const result: FormResponse = await response.json();
      if (controller.signal.aborted) return;
      if (request.timedOut) throw new Error("Request timed out.");
      if (!response.ok || !result.user) {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.error ?? "We couldn’t complete this request. Try again.");
        const field = fields.find((field) => result.fieldErrors?.[field]);
        setLoading(false);
        requestAnimationFrame(() => { if (field) (form.elements.namedItem(field) as HTMLInputElement)?.focus(); });
        return;
      }
      // A fresh document clears any previously cached anonymous route payloads.
      window.location.replace(result.user.role === "ADMIN" ? "/admin" : "/dashboard");
    } catch {
      if (controller.signal.aborted) return;
      setMessage(request.timedOut ? register ? "Creating your account took too long. It may have completed; try signing in before registering again." : "Signing in took too long. Check your connection and try again." : "Unable to connect. Please try again.");
      setLoading(false);
    } finally { request.dispose(); if (active.current === controller) active.current = null; }
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-busy={loading} className="space-y-6">
      {register && <AuthField id="name" name="name" label="Name" autoComplete="name" placeholder="Your name" required maxLength={80}
        value={values.name} error={errors.name} disabled={loading} onBlur={() => blur("name")} onChange={(event) => update("name", event.target.value)} />}
      <AuthField id="email" name="email" label="Email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
        placeholder="you@example.com" required maxLength={254} value={values.email} error={errors.email} disabled={loading}
        onBlur={() => blur("email")} onChange={(event) => update("email", event.target.value)} />
      <AuthField id="password" name="password" label="Password" type="password" autoComplete={register ? "new-password" : "current-password"} required maxLength={128}
        placeholder={register ? "At least 8 characters" : "Enter your password"} value={values.password} error={errors.password} disabled={loading}
        onBlur={() => blur("password")} onChange={(event) => update("password", event.target.value)}
        hint={register ? (
          <div className="space-y-2">
            <div className="flex gap-1.5" aria-hidden="true">
              {[1, 2, 3, 4].map((segment) => <span key={segment} className={`h-[3px] flex-1 rounded-full transition-colors duration-200 ${segment <= strength.score ? "bg-foreground/65" : "bg-border"}`} />)}
            </div>
            <div className="flex items-center justify-between gap-3 text-xs leading-relaxed text-muted-foreground">
              <span>{values.password ? "Password strength" : strength.label}</span>
              {values.password && <span className="font-medium text-foreground">{strength.label}</span>}
            </div>
          </div>
        ) : undefined} />
      {register && <AuthField id="confirmPassword" name="confirmPassword" label="Confirm Password" type="password" autoComplete="new-password" required maxLength={128}
        placeholder="Enter your password again" value={values.confirmPassword} error={errors.confirmPassword} disabled={loading}
        onBlur={() => blur("confirmPassword")} onChange={(event) => update("confirmPassword", event.target.value)} />}
      {!register && (
        <div className="-my-1 flex flex-wrap items-center justify-between gap-x-4">
          <Label htmlFor="remember" className="min-h-11 cursor-pointer gap-2 text-[13px] font-normal text-muted-foreground">
            <input id="remember" type="checkbox" checked={remember} disabled={loading} onChange={(event) => setRemember(event.target.checked)}
              className="size-4 rounded-[4px] border-border accent-primary focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:opacity-40" />
            Remember me
          </Label>
          <ForgotPasswordDialog disabled={loading} />
        </div>
      )}
      {message && <p role="alert" className="rounded-sm bg-destructive/5 p-4 text-[13px] leading-relaxed text-destructive">{message}</p>}
      <p role="status" className="sr-only">{loading ? register ? "Creating your account." : "Signing in." : ""}</p>
      <Button type="submit" loading={loading} disabled={empty || loading} className="w-full">
        {loading ? (register ? "Creating account…" : "Signing in…") : (register ? "Create account" : "Sign in")}
      </Button>
      <p className="pt-2 text-center text-[13px] leading-relaxed text-muted-foreground">
        {register ? "Already have an account?" : "New to Token Depot?"}{" "}
        <Link href={register ? "/login" : "/register"} className="auth-link inline-flex min-h-11 items-center">{register ? "Sign in" : "Create account"}</Link>
      </p>
      {register && <p className="text-center text-xs leading-6 text-muted-foreground">Review the <Link href="/terms" className="auth-link">Terms</Link> and <Link href="/privacy" className="auth-link">Privacy Policy</Link> before creating an account.</p>}
    </form>
  );
}
