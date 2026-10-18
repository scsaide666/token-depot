"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogFooter } from "@/components/ui/dialog";
import { channelBody, channelPatch, type ChannelInput } from "@/lib/provider-schemas";
import type { ChannelRecord } from "@/lib/provider-types";
import { providerNames } from "@/lib/model-types";

const numericFields = [["priority", "Priority", 100], ["weight", "Weight", 1], ["rpm", "Requests / minute", 60], ["tpm", "Tokens / minute", 200000],
  ["concurrency", "Concurrent requests", 10], ["timeoutMs", "Timeout (ms)", 90000], ["failureThreshold", "Failure threshold", 5], ["cooldownMs", "Cooldown (ms)", 30000]] as const;
export function ProviderForm({ channel, pending, onSave, onCancel }: {
  channel?: ChannelRecord; pending: boolean; onSave: (fields: ChannelInput | Partial<Omit<ChannelInput, "code" | "provider">>) => Promise<void>; onCancel: () => void;
}) {
  const [provider, setProvider] = useState<ChannelInput["provider"]>(channel?.provider ?? "DEEPSEEK"), [error, setError] = useState("");
  const prefix = provider === "GOOGLE" ? "GEMINI" : provider;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return; setError("");
    const values = new FormData(event.currentTarget);
    const fields = { name: String(values.get("name") ?? ""), apiKeyEnv: String(values.get("apiKeyEnv") ?? ""), baseUrlEnv: String(values.get("baseUrlEnv") ?? ""),
      enabled: values.has("enabled"), idempotentRequests: values.has("idempotentRequests"),
      ...Object.fromEntries(numericFields.map(([key]) => [key, Number(values.get(key))])) };
    const result = channel ? channelPatch.safeParse(fields) : channelBody.safeParse({ ...fields, code: values.get("code"), provider });
    if (!result.success) { setError("Check the channel fields. Use valid environment names and whole-number limits."); return; }
    try { await onSave(result.data); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save channel."); }
  }
  return <form onSubmit={submit} className="space-y-5">
    <div className="max-h-[56dvh] space-y-4 overflow-y-auto px-1 pb-1">
      <label className="block space-y-2"><span className="text-xs text-muted-foreground">Name</span><Input id="admin-channel-name" name="name" required maxLength={120} defaultValue={channel?.name} placeholder="DeepSeek Primary" disabled={pending} /></label>
      {!channel && <div className="grid grid-cols-2 gap-3"><label className="space-y-2"><span className="text-xs text-muted-foreground">Channel code</span><Input name="code" required maxLength={100} placeholder="deepseek-primary" disabled={pending} /></label>
        <label className="space-y-2"><span className="text-xs text-muted-foreground">Provider</span><select name="provider" value={provider} disabled={pending} onChange={e => setProvider(e.target.value as ChannelInput["provider"])} className="h-11 w-full rounded-sm border border-input bg-card px-3 text-sm">{Object.entries(providerNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>}
      <label className="block space-y-2"><span className="text-xs text-muted-foreground">API key environment name</span><Input key={prefix + "key"} name="apiKeyEnv" required maxLength={100} defaultValue={channel?.apiKeyEnv ?? `${prefix}_API_KEY`} disabled={pending} className="font-mono text-xs" /></label>
      <label className="block space-y-2"><span className="text-xs text-muted-foreground">Base URL environment name</span><Input key={prefix + "url"} name="baseUrlEnv" required maxLength={100} defaultValue={channel?.baseUrlEnv ?? `${prefix}_BASE_URL`} disabled={pending} className="font-mono text-xs" /></label>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Reference server configuration by name. Keep the actual key and URL in the server environment.</p>
      <div className="grid grid-cols-2 gap-3">{numericFields.map(([key, label, fallback]) => <label key={key} className="space-y-2"><span className="text-[11px] text-muted-foreground">{label}</span><Input name={key} type="number" required step="1" min={key === "priority" ? 0 : key === "timeoutMs" || key === "cooldownMs" ? 100 : 1} defaultValue={channel?.[key] ?? fallback} disabled={pending} /></label>)}</div>
      <label className="flex items-center gap-2 text-xs"><input name="enabled" type="checkbox" defaultChecked={channel?.enabled ?? true} disabled={pending} className="size-4 accent-[var(--primary)]" />Enable channel</label>
      <label className="flex items-start gap-2 text-xs leading-relaxed"><input name="idempotentRequests" type="checkbox" defaultChecked={channel?.idempotentRequests ?? false} disabled={pending} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" /><span>Verified support for Idempotency-Key<span className="mt-1 block text-[11px] text-muted-foreground">Enable only when the upstream guarantees one execution and one charge for a repeated key. Uncertain requests may then retry this channel.</span></span></label>
    </div>
    {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
    <DialogFooter><Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button><Button loading={pending} type="submit" disabled={pending}>{pending ? "Saving…" : channel ? "Save changes" : "Create channel"}</Button></DialogFooter>
  </form>;
}
