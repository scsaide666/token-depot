"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { providerNames, type AdminModelRecord, type Provider } from "@/lib/model-types";
import { modelBody, type ModelInput } from "@/lib/model-schemas";
import { ModelRequestError } from "@/lib/model-client";

type Fields = Omit<ModelInput, "contextWindow"> & { contextWindow: string };
type FieldName = Exclude<keyof Fields, "provider" | "enabled">;
const labels: Record<FieldName, string> = { name: "Model name", slug: "Model ID (slug)", providerModel: "Provider model ID", description: "Description", contextWindow: "Context window", inputPricePerMillion: "Input provider cost", outputPricePerMillion: "Output provider cost", markupMultiplier: "Markup multiplier" };
export function AdminModelForm({ model, onSave, onCancel, pending }: { model?: AdminModelRecord; onSave: (data: ModelInput) => Promise<void>; onCancel: () => void; pending: boolean }) {
  const [fields, setFields] = useState<Fields>({ name: model?.name ?? "", slug: model?.slug ?? "", provider: model?.providerCode ?? "DEEPSEEK", providerModel: model?.providerModel ?? "", description: model?.description ?? "", contextWindow: model ? String(model.contextWindow) : "", inputPricePerMillion: model?.inputCostPerMillion ?? "", outputPricePerMillion: model?.outputCostPerMillion ?? "", markupMultiplier: model?.markupMultiplier ?? "1", enabled: model?.enabled ?? true });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [requestError, setRequestError] = useState("");
  function update(field: FieldName, value: string) { setFields((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: [] })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return; setRequestError("");
    const parsed = modelBody.safeParse({ ...fields, contextWindow: /^\d+$/.test(fields.contextWindow) ? Number(fields.contextWindow) : null });
    if (!parsed.success) { const nextErrors = parsed.error.flatten().fieldErrors; setErrors(nextErrors); document.getElementById(`admin-model-${Object.keys(nextErrors)[0]}`)?.focus(); return; }
    setErrors({});
    try { await onSave(parsed.data); }
    catch (error) { setRequestError(error instanceof Error ? error.message : "Unable to save this model. Please try again."); if (error instanceof ModelRequestError) setErrors(error.fieldErrors); }
  }
  function field(name: FieldName, placeholder: string, hint?: string) {
    const decimal = name.includes("Price") || name === "markupMultiplier";
    return <div className="min-w-0 space-y-2"><label htmlFor={`admin-model-${name}`} className="text-xs font-medium">{labels[name]}</label><Input id={`admin-model-${name}`} value={fields[name]} onChange={(event) => update(name, event.target.value)} placeholder={placeholder} disabled={pending} inputMode={name === "contextWindow" ? "numeric" : decimal ? "decimal" : "text"} autoComplete="off" maxLength={name === "description" ? 1000 : name === "providerModel" ? 200 : name === "name" ? 120 : name === "slug" ? 100 : 24} aria-invalid={!!errors[name]?.length} aria-describedby={errors[name]?.length ? `admin-model-${name}-error` : hint ? `admin-model-${name}-hint` : undefined} className={name === "slug" || name === "providerModel" ? "font-mono text-sm" : ""} />{hint && <p id={`admin-model-${name}-hint`} className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}{errors[name]?.length ? <p id={`admin-model-${name}-error`} role="alert" className="text-xs leading-relaxed text-destructive">{errors[name][0]}</p> : null}</div>;
  }
  return <form onSubmit={submit} noValidate aria-busy={pending} className="space-y-4">
    {field("name", "DeepSeek Flash")}{field("slug", "deepseek-flash", "Public identifier. Changing it updates the catalog and examples.")}
    <div className="space-y-2"><label htmlFor="admin-model-provider" className="text-xs font-medium">Provider</label><select id="admin-model-provider" value={fields.provider} disabled={pending} onChange={(event) => setFields((current) => ({ ...current, provider: event.target.value as Provider }))} className="h-11 w-full rounded-sm border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15">{Object.entries(providerNames).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
    {field("providerModel", "upstream-model-id", "Internal provider identifier. Visible only to administrators.")}{field("description", "Advanced reasoning and general-purpose model.")}{field("contextWindow", "400000", "Maximum context window in tokens.")}
    <div className="grid grid-cols-2 gap-3">{field("inputPricePerMillion", "1.25", "CNY / 1M input tokens")}{field("outputPricePerMillion", "10", "CNY / 1M output tokens")}</div>
    {field("markupMultiplier", "1.2", "Selling price = provider cost × markup. Calculated exactly on the server.")}
    <label className="flex items-center gap-2.5 text-xs"><input type="checkbox" checked={fields.enabled} disabled={pending} onChange={(event) => setFields((current) => ({ ...current, enabled: event.target.checked }))} className="size-4 accent-primary" />Enabled in the public catalog</label>
    {requestError && <p role="alert" className="text-xs leading-relaxed text-destructive">{requestError}</p>}
    <DialogFooter className="pt-2"><Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button><Button loading={pending} type="submit" disabled={pending}>{pending ? "Saving…" : model ? "Save changes" : "Create model"}</Button></DialogFooter>
  </form>;
}
