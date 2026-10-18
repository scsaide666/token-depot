"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { validateEmail } from "@/lib/auth-validation";
import { AuthField } from "./auth-field";
import { usePreviewSubmission } from "./use-preview-submission";

export function ForgotPasswordDialog({ disabled }: { disabled: boolean }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const preview = usePreviewSubmission();
  const loading = preview.status === "loading";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (loading) return;
    const nextError = validateEmail(email);
    setError(nextError);
    if (nextError) {
      (event.currentTarget.elements.namedItem("reset-email") as HTMLInputElement)?.focus();
      return;
    }
    preview.submit();
  }

  return (
    <Dialog onOpenChange={() => { preview.reset(); setEmail(""); setError(undefined); }}>
      <DialogTrigger asChild>
        <button type="button" disabled={disabled} className="auth-link min-h-11 text-[13px] disabled:opacity-40">Forgot password?</button>
      </DialogTrigger>
      <DialogContent lang="en" showCloseButton={false} className="data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100">
        <DialogHeader>
          <DialogTitle className="tracking-[-0.03em]">Reset your password</DialogTitle>
          <DialogDescription className="leading-relaxed">Enter your account email to preview the reset flow.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit} className="mt-2 space-y-5" aria-busy={loading}>
          <AuthField id="reset-email" name="reset-email" label="Email" type="email" inputMode="email" autoComplete="email" required
            value={email} error={error} disabled={loading} placeholder="you@example.com"
            onBlur={() => setError(validateEmail(email))}
            onChange={(event) => { setEmail(event.target.value); if (error) setError(validateEmail(event.target.value)); preview.reset(); }} />
          <div role="status" aria-live="polite" className={preview.status === "complete" ? "rounded-sm bg-secondary/60 p-3.5 text-sm leading-relaxed text-muted-foreground" : "sr-only"}>
            {loading ? "Preparing reset preview." : preview.status === "complete" ? "Reset preview complete. No email was sent; password recovery isn’t connected yet." : ""}
          </div>
          <Button type="submit" loading={loading} disabled={loading || !email.trim()} className="w-full">{loading ? "Preparing…" : "Continue"}</Button>
          <DialogClose asChild><Button type="button" variant="ghost" className="w-full">Back to sign in</Button></DialogClose>
        </form>
      </DialogContent>
    </Dialog>
  );
}
