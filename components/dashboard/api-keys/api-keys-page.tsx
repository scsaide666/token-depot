"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeCopyButton } from "@/components/home/code-copy-button";
import { maskedApiKey, type ApiKeyRecord } from "@/lib/api-key-types";
import { apiKeyNameSchema } from "@/lib/api-key-schemas";
import { KeysTable } from "./keys-table";
import type { KeyAction } from "./key-actions";
import { ConsoleFeedback, ConsolePageHeader, ConsoleTableSkeleton } from "../console-primitives";

type KeyDialog = { kind: "create" } | { kind: "ready"; name: string } | { kind: KeyAction; record: ApiKeyRecord };
type KeyResponse = { apiKeys?: ApiKeyRecord[]; apiKey?: ApiKeyRecord; key?: string; error?: string; fieldErrors?: { name?: string } };
class KeyRequestError extends Error { constructor(message: string, public nameError?: string) { super(message); } }

async function keyRequest(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<KeyResponse> {
  const response = await fetch(path, { method, cache: "no-store", signal, ...(method !== "GET" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) } : {}) });
  const result: KeyResponse = await response.json();
  if (response.status === 401) { window.location.replace("/login"); throw new KeyRequestError("Your session has ended. Sign in again."); }
  if (!response.ok) throw new KeyRequestError(result.error ?? "Unable to complete this request. Please try again.", result.fieldErrors?.name);
  return result;
}

export function ApiKeysPage() {
  const [records, setRecords] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [dialog, setDialog] = useState<KeyDialog>({ kind: "create" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [fullKey, setFullKey] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [copyError, setCopyError] = useState("");
  const createRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const formDialog = dialog.kind === "create" || dialog.kind === "rename";
  const destructiveDialog = dialog.kind === "revoke" || dialog.kind === "delete";

  useEffect(() => {
    const controller = new AbortController();
    keyRequest("/api/api-keys", "GET", undefined, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setRecords(result.apiKeys ?? []); setLoading(false); }
    }).catch(() => {
      if (!controller.signal.aborted) { setLoadError("Unable to load your API keys. Please try again."); setLoading(false); }
    });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (dialogOpen && dialog.kind === "ready") keyRef.current?.focus();
  }, [dialogOpen, dialog.kind]);

  function openDialog(next: KeyDialog, trigger: HTMLElement | null) {
    triggerRef.current = trigger;
    setDialog(next);
    setName(next.kind === "rename" ? next.record.name : "");
    setNameError("");
    setFullKey("");
    setCopyError("");
    setAnnouncement("");
    setRequestError("");
    setDialogOpen(true);
  }

  function closeDialog() {
    if (pending) return;
    setDialogOpen(false);
    // Only the masked value is retained in the list.
    setFullKey("");
    setName("");
    setNameError("");
    setRequestError("");
  }

  function restoreFocus() {
    if (triggerRef.current?.isConnected) triggerRef.current.focus();
    else createRef.current?.focus();
  }

  async function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = apiKeyNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0].message);
      nameRef.current?.focus();
      return;
    }
    setPending(true); setRequestError(""); setNameError("");
    try {
      if (dialog.kind === "create") {
        const result = await keyRequest("/api/api-keys", "POST", { name: parsed.data });
        if (!result.apiKey || !result.key) throw new KeyRequestError("Unable to create your key. Please try again.");
        setRecords((current) => [result.apiKey!, ...current]);
        setFullKey(result.key);
        setDialog({ kind: "ready", name: result.apiKey.name });
        setName("");
        setAnnouncement(`${result.apiKey.name} was created.`);
      } else if (dialog.kind === "rename") {
        const result = await keyRequest(`/api/api-keys/${dialog.record.id}`, "PATCH", { name: parsed.data });
        if (!result.apiKey) throw new KeyRequestError("Unable to rename your key. Please try again.");
        setRecords((current) => current.map((record) => record.id === dialog.record.id ? result.apiKey! : record));
        setAnnouncement(`Key renamed to ${result.apiKey.name}.`);
        setDialogOpen(false); setName("");
      }
    } catch (error) {
      setRequestError(error instanceof KeyRequestError ? error.message : "Unable to connect. Please try again.");
      if (error instanceof KeyRequestError && error.nameError) { setNameError(error.nameError); requestAnimationFrame(() => nameRef.current?.focus()); }
    } finally { setPending(false); }
  }

  async function confirmAction() {
    if (pending || (dialog.kind !== "revoke" && dialog.kind !== "delete")) return;
    setPending(true); setRequestError("");
    try {
      if (dialog.kind === "revoke") {
        const result = await keyRequest(`/api/api-keys/${dialog.record.id}/revoke`, "POST", {});
        if (!result.apiKey) throw new KeyRequestError("Unable to revoke your key. Please try again.");
        setRecords((current) => current.map((record) => record.id === dialog.record.id ? result.apiKey! : record));
        setAnnouncement(`${dialog.record.name} was revoked.`);
      } else {
        await keyRequest(`/api/api-keys/${dialog.record.id}`, "DELETE", {});
        setRecords((current) => current.filter((record) => record.id !== dialog.record.id));
        setAnnouncement(`${dialog.record.name} was deleted.`);
      }
      setDialogOpen(false);
    } catch (error) { setRequestError(error instanceof KeyRequestError ? error.message : "Unable to connect. Please try again."); }
    finally { setPending(false); }
  }

  async function copyMaskedKey(record: ApiKeyRecord) {
    setCopyError("");
    setAnnouncement("");
    try {
      await navigator.clipboard.writeText(maskedApiKey(record));
      setAnnouncement(`Masked key for ${record.name} copied.`);
    } catch {
      setCopyError("Could not access the clipboard. Select the masked key in the table to copy it manually.");
    }
  }

  return (
    <div className="console-page console-keys-page">
      <ConsolePageHeader title="API Keys" description="Create and manage keys used to access the Token Depot API." actions={<Button ref={createRef} disabled={loading || pending || !!loadError} onClick={(event) => openDialog({ kind: "create" }, event.currentTarget)}>Create API Key</Button>} />
      <p className="console-security-note">Keep API keys on your server. Full keys are shown only once; existing keys remain masked.</p>
      <div className="console-page-content" aria-busy={loading}>
        {loading ? <ConsoleTableSkeleton label="Loading your API keys" /> : loadError ? <section className="console-empty"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button variant="secondary" className="mt-5" onClick={() => { setLoadError(""); setLoading(true); setReload((value) => value + 1); }}>Try again</Button></section> : records.length > 0 ? (
          <KeysTable records={records} onCopy={copyMaskedKey} onAction={(action, record, trigger) => openDialog({ kind: action, record }, trigger)} />
        ) : (
          <section aria-labelledby="empty-keys-heading" className="console-empty">
            <KeyRound className="mb-5 size-6 text-muted-foreground" strokeWidth={1.4} aria-hidden="true" />
            <h2 id="empty-keys-heading" className="text-xl font-semibold tracking-[-0.025em]">No API keys yet</h2>
            <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-muted-foreground">Create an API key to start making requests.</p>
            <Button className="mt-6" onClick={(event) => openDialog({ kind: "create" }, event.currentTarget)}>Create API Key</Button>
          </section>
        )}
      </div>
      <ConsoleFeedback key={`${announcement}-${copyError}`} message={copyError || announcement} error={!!copyError} />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent lang="en" showCloseButton={false}
          aria-busy={pending}
          onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}
          onInteractOutside={(event) => { if (pending) event.preventDefault(); }}
          onOpenAutoFocus={(event) => { event.preventDefault(); if (formDialog) nameRef.current?.focus(); else if (dialog.kind === "ready") keyRef.current?.focus(); else document.getElementById("cancel-key-action")?.focus(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}
          className={`dashboard-console console-dialog ${dialog.kind === "ready" ? "data-[state=closed]:invisible" : ""}`}>
          <DialogHeader>
            <DialogTitle className="tracking-[-0.03em]">
              {dialog.kind === "create" ? "Create API Key" : dialog.kind === "ready" ? "Your API key is ready" : dialog.kind === "rename" ? "Rename API key" : dialog.kind === "revoke" ? "Revoke API key?" : "Delete API key?"}
            </DialogTitle>
            <DialogDescription className="pt-2 leading-relaxed">
              {dialog.kind === "create" ? "Give your key a name you’ll recognize." : dialog.kind === "ready" ? "Save this key now. You won’t be able to view it again." : dialog.kind === "rename" ? "Update the name used to identify this key." : dialog.kind === "revoke" ? <>Revoke <span className="font-medium text-foreground break-words">{dialog.record.name}</span>? This key will no longer be able to make API requests. This action can’t be undone.</> : <>Delete <span className="font-medium text-foreground break-words">{dialog.record.name}</span>? This removes it from your key list. This action can’t be undone.</>}
            </DialogDescription>
          </DialogHeader>
          {requestError && <p role="alert" className="rounded-sm bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">{requestError}</p>}
          {formDialog && (
            <form noValidate onSubmit={submitName}>
              <div className="space-y-2.5 py-5">
                <Label htmlFor="api-key-name" className="text-[13px]">Key Name</Label>
                <Input ref={nameRef} id="api-key-name" name="keyName" placeholder="Production" maxLength={64} autoComplete="off" required disabled={pending} value={name} aria-invalid={!!nameError} aria-describedby={nameError ? "api-key-name-error" : undefined}
                  onBlur={() => { if (!name.trim()) setNameError("Enter a name for your API key."); }} onChange={(event) => { setName(event.target.value); if (event.target.value.trim()) setNameError(""); }} />
                {nameError && <p id="api-key-name-error" role="alert" className="text-xs text-destructive">{nameError}</p>}
              </div>
              <DialogFooter><Button type="button" variant="secondary" disabled={pending} onClick={closeDialog}>Cancel</Button><Button loading={pending} type="submit" disabled={pending} className="hover:brightness-95">{pending ? dialog.kind === "create" ? "Creating…" : "Saving…" : dialog.kind === "create" ? "Create Key" : "Save changes"}</Button></DialogFooter>
            </form>
          )}
          {dialog.kind === "ready" && dialogOpen && (
            <>
              <div className="my-2 flex items-center gap-3 rounded-md border border-border/60 bg-background/65 p-3.5">
                <code ref={keyRef} tabIndex={0} aria-label="Your API key" className="min-w-0 flex-1 rounded-sm font-mono text-[13px] leading-[1.8] break-all outline-none focus-visible:ring-2 focus-visible:ring-ring/20">{fullKey}</code>
                <div className="shrink-0 [&_button]:h-11"><CodeCopyButton key={fullKey} code={fullKey} label="Copy API key" successMessage="API key copied." showLabel /></div>
              </div>
              <DialogFooter className="mt-2"><Button type="button" onClick={closeDialog} className="hover:brightness-95">Done</Button></DialogFooter>
            </>
          )}
          {destructiveDialog && (
            <DialogFooter className="mt-4"><Button id="cancel-key-action" variant="secondary" disabled={pending} onClick={closeDialog}>Cancel</Button><Button loading={pending} variant="destructive" disabled={pending} onClick={confirmAction}>{pending ? dialog.kind === "revoke" ? "Revoking…" : "Deleting…" : dialog.kind === "revoke" ? "Revoke Key" : "Delete Key"}</Button></DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
