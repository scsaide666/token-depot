"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestSignal } from "@/lib/client/request-signal";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/auth/account-provider";
import { AuthField } from "@/components/auth/auth-field";
import { Button } from "@/components/ui/button";
import { nameSchema } from "@/lib/auth-schemas";
import type { FormResponse } from "@/lib/account-types";
import { profileInitials } from "@/lib/settings-demo-data";
import { SettingsSection } from "./settings-section";

export function ProfileSection() {
  const user = useAccount();
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [savedName, setSavedName] = useState(user.name);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || active.current) return;
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) { setError(parsed.error.issues[0].message); nameRef.current?.focus(); return; }
    setLoading(true); setError(""); setMessage("");
    const controller = new AbortController(); active.current = controller;
    const request = requestSignal(30000, controller.signal);
    try {
      const response = await fetch("/api/profile", { method: "PATCH", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: parsed.data }) });
      const result: FormResponse = await response.json();
      if (controller.signal.aborted) return;
      if (request.timedOut) throw new Error("Request timed out.");
      if (response.status === 401) { window.location.replace("/login"); return; }
      if (!response.ok || !result.user) { setError(result.fieldErrors?.name ?? result.error ?? "Your changes could not be saved."); setLoading(false); requestAnimationFrame(() => nameRef.current?.focus()); return; }
      setName(result.user.name); setSavedName(result.user.name); setMessage("Profile changes saved."); router.refresh();
    } catch {
      if (controller.signal.aborted) return;
      setError(request.timedOut ? "Saving took too long. Reload to check whether your changes were saved." : "Unable to connect. Please try again.");
    } finally { request.dispose(); if (active.current === controller) active.current = null; }
    setLoading(false);
  }

  return <SettingsSection id="profile" title="Profile" description="Your personal details and profile photo.">
    <form onSubmit={saveProfile} noValidate aria-busy={loading} className="max-w-[520px]">
      <div className="flex flex-wrap items-center gap-4"><div role="img" aria-label="Profile initials" className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-lg font-medium">{profileInitials(name)}</div><div><p className="text-[13px] font-medium">Avatar</p><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Your initials are used for now.</p></div></div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <AuthField ref={nameRef} id="profile-name" label="Name" name="name" autoComplete="name" maxLength={80} required disabled={loading} value={name} error={error || undefined} onChange={(event) => { setName(event.target.value); setError(""); setMessage(""); }} onBlur={() => { const parsed = nameSchema.safeParse(name); setError(parsed.success ? "" : parsed.error.issues[0].message); }} />
        <AuthField id="profile-email" label="Email" type="email" autoComplete="email" value={user.email} readOnly hint={<p className="text-[11px] leading-relaxed text-muted-foreground">Email changes aren’t available yet.</p>} />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3"><Button loading={loading} type="submit" disabled={name.trim() === savedName || loading} className="w-full sm:w-auto">{loading ? "Saving…" : "Save Changes"}</Button><p role="status" className="text-xs leading-relaxed text-muted-foreground">{message}</p></div>
    </form>
  </SettingsSection>;
}
