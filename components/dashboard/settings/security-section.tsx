"use client";

import { useRef, useState } from "react";
import { Monitor, X } from "lucide-react";
import { LogoutButton, signOut } from "@/components/auth/logout-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AccountSession } from "@/lib/account-types";
import { SettingsSection } from "./settings-section";

const sessionDate = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));

function ActiveSessionsDialog({ sessions }: { sessions: AccountSession[] }) {
  return <Dialog><DialogTrigger asChild><Button variant="secondary" className="w-full text-xs sm:w-auto">Active Sessions</Button></DialogTrigger><DialogContent lang="en" showCloseButton={false} className="data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 sm:max-w-[480px]"><DialogClose asChild><Button variant="ghost" size="icon-sm" aria-label="Close Active Sessions" className="absolute top-4 right-4 text-muted-foreground"><X className="size-[18px]" aria-hidden="true" /></Button></DialogClose><DialogHeader className="pr-6"><DialogTitle>Active Sessions</DialogTitle><DialogDescription className="pt-1 leading-relaxed">Sessions with access to your account.</DialogDescription></DialogHeader><ul className="divide-y divide-border/60">{sessions.map((session) => <li key={session.id} className="flex items-start gap-3 py-4"><Monitor className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" /><div className="min-w-0"><p className="text-[13px] font-medium">{session.device}</p><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Created {sessionDate(session.createdAt)} UTC</p><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Expires {sessionDate(session.expiresAt)} UTC</p>{session.current && <Badge variant="secondary" className="mt-2.5 text-[10px] font-normal text-muted-foreground">Current session</Badge>}</div></li>)}</ul><DialogClose asChild><Button variant="secondary" className="sm:ml-auto">Close</Button></DialogClose></DialogContent></Dialog>;
}

function SignOutAllDevices() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  async function logout() { setLoading(true); setError(""); try { await signOut(true); } catch { setError("Unable to sign out. Please try again."); setLoading(false); } }
  return <Dialog open={open} onOpenChange={(next) => { if (!loading) { setError(""); setOpen(next); } }}><DialogTrigger asChild><Button variant="ghost" className="w-full text-xs text-destructive hover:bg-destructive/5 hover:text-destructive sm:w-auto">Sign out all devices</Button></DialogTrigger><DialogContent lang="en" showCloseButton={false} onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }} onEscapeKeyDown={(event) => { if (loading) event.preventDefault(); }} onInteractOutside={(event) => { if (loading) event.preventDefault(); }} className="data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100"><DialogHeader><DialogTitle>Sign out all devices?</DialogTitle><DialogDescription className="pt-1 leading-relaxed">This will end every active session, including this device. You will need to sign in again.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button ref={cancelRef} variant="secondary" disabled={loading} onClick={() => setOpen(false)}>Cancel</Button><Button loading={loading} variant="ghost" disabled={loading} className="text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={logout}>{loading ? "Signing out…" : "Sign out all devices"}</Button></div></DialogContent></Dialog>;
}

export function SecuritySection({ sessions }: { sessions: AccountSession[] }) {
  return <>
    <SettingsSection id="security" title="Security" description="Manage your password and signed-in devices."><div className="max-w-[520px]">
      <div className="settings-row flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div><h3 className="text-[13px] font-medium">Password</h3><p className="mt-1.5 text-xs text-muted-foreground">Password changes aren’t available yet.</p></div><Button variant="secondary" disabled className="w-full text-xs sm:w-auto">Change Password</Button></div>
      <div className="settings-row flex flex-col items-start justify-between gap-4 border-t border-border/60 sm:flex-row sm:items-center"><div><h3 className="text-[13px] font-medium">Active Sessions</h3><p className="mt-1.5 text-xs text-muted-foreground">{sessions.length} active {sessions.length === 1 ? "session" : "sessions"}.</p></div><ActiveSessionsDialog sessions={sessions} /></div>
      <div className="settings-row flex flex-col items-start justify-between gap-4 border-t border-border/60 sm:flex-row sm:items-center"><div><h3 className="text-[13px] font-medium">This device</h3><p className="mt-1.5 text-xs text-muted-foreground">End your current session.</p></div><LogoutButton className="w-full text-xs sm:w-auto" /></div>
      <div className="settings-row flex flex-col items-start justify-between gap-4 border-t border-border/60 sm:flex-row sm:items-center"><div><h3 className="text-[13px] font-medium">Sign out everywhere</h3><p className="mt-1.5 text-xs text-muted-foreground">End all active sessions.</p></div><SignOutAllDevices /></div>
    </div></SettingsSection>
    <SettingsSection id="danger-zone" title="Danger Zone" description="Permanently remove your account."><div className="flex max-w-[520px] flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div><h3 className="text-[13px] font-medium">Delete Account</h3><p className="mt-1.5 max-w-[32ch] text-xs leading-relaxed text-muted-foreground">Account deletion isn’t available yet.</p></div><Button variant="ghost" disabled className="w-full text-xs text-destructive sm:w-auto">Delete Account</Button></div></SettingsSection>
  </>;
}
