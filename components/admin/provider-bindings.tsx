"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { bindingBody, type BindingInput } from "@/lib/provider-schemas";
import { adminRequest } from "@/lib/admin-client";
import { modelPrice } from "@/lib/model-types";
import type { BindingRecord, ChannelRecord } from "@/lib/provider-types";
import type { PageInfo } from "@/lib/analytics-types";
import { DataPagination } from "@/components/dashboard/analytics/pagination";
import { AdminDataTable, AdminStatus } from "./admin-ui";

export type BindingsData = { bindings: BindingRecord[]; pagination: PageInfo };
export function ProviderBindings({ channel, data, onLoad, onSaved }: { channel: ChannelRecord; data: BindingsData; onLoad: (page: number) => Promise<void>; onSaved: () => Promise<void> }) {
  const [selected, setSelected] = useState<BindingRecord>(), [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  function edit(binding?: BindingRecord) { setSelected(binding); setRevision(n => n + 1); setError(""); setNotice(""); }
  async function save(fields: BindingInput) {
    setPending(true); setError(""); setNotice("");
    try { await adminRequest(`/api/admin/providers/${channel.id}/models`, "POST", fields); setNotice("Model route saved."); edit(); await onSaved(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save model route."); }
    finally { setPending(false); }
  }
  async function prefer(binding: BindingRecord) {
    const { modelSlug, providerModel, contextWindow, inputPricePerMillion, outputPricePerMillion } = binding;
    await save({ modelSlug, providerModel, contextWindow, inputPricePerMillion, outputPricePerMillion, enabled: true, preferred: !binding.preferred });
  }
  return <div className="max-h-[65dvh] space-y-5 overflow-y-auto px-1 pb-1">
    <AdminDataTable label="Channel model bindings" columns={[{ label: "Model" }, { label: "Cost / 1M" }, { label: "Route" }, { label: "Actions" }]} minWidth={560}>
      {!data.bindings.length && <TableRow><TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No models bound to this channel.</TableCell></TableRow>}
      {data.bindings.map(binding => <TableRow key={binding.id}><TableCell><p className="font-mono text-xs">{binding.modelSlug}</p><p className="mt-1 text-[10px] text-muted-foreground">{binding.contextWindow.toLocaleString()} context</p></TableCell>
        <TableCell className="text-xs tabular-nums"><p>In {modelPrice(binding.inputPricePerMillion)}</p><p className="mt-1 text-muted-foreground">Out {modelPrice(binding.outputPricePerMillion)}</p></TableCell>
        <TableCell><AdminStatus status={!binding.compatible ? "Incompatible" : !binding.enabled ? "Disabled" : binding.preferred ? "Preferred" : "Enabled"} /></TableCell>
        <TableCell><div className="flex items-center gap-1"><Button variant="ghost" size="sm" disabled={pending} onClick={() => edit(binding)}>Edit</Button><Button size="sm" variant="ghost" disabled={pending || !binding.compatible || !channel.enabled} onClick={() => void prefer(binding)}>{binding.preferred ? "Automatic" : "Prefer"}</Button></div></TableCell></TableRow>)}
    </AdminDataTable>
    <DataPagination pagination={data.pagination} label="Model bindings" disabled={pending} onChange={page => void onLoad(page)} />
    <div className="flex items-center justify-between"><p className="text-sm font-medium">{selected ? "Edit model binding" : "Add model binding"}</p>{selected && <Button size="sm" variant="ghost" disabled={pending} onClick={() => edit()}>Add new</Button>}</div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">Bind only the exact same provider model and a sufficient context window. Preferred routes still respect health, circuit and capacity limits.</p>
    <BindingForm key={revision} selected={selected} pending={pending} onSave={save} />
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}{notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
  </div>;
}
function BindingForm({ selected, pending, onSave }: { selected?: BindingRecord; pending: boolean; onSave: (fields: BindingInput) => Promise<void> }) {
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); const values = new FormData(e.currentTarget);
    const result = bindingBody.safeParse({ modelSlug: values.get("modelSlug"), providerModel: values.get("providerModel"), contextWindow: Number(values.get("contextWindow")),
      inputPricePerMillion: values.get("inputPricePerMillion"), outputPricePerMillion: values.get("outputPricePerMillion"), enabled: values.has("enabled"), preferred: values.has("preferred") });
    if (!result.success) { setError("Check the model ID, context window and decimal CNY costs."); return; }
    await onSave(result.data);
  }
  return <form onSubmit={submit} className="space-y-4">
    <label className="block space-y-2"><span className="text-xs text-muted-foreground">Platform model ID</span><Input name="modelSlug" required maxLength={100} defaultValue={selected?.modelSlug} readOnly={!!selected} disabled={pending} placeholder="deepseek-flash" className="font-mono text-xs" /></label>
    <label className="block space-y-2"><span className="text-xs text-muted-foreground">Exact upstream model ID</span><Input name="providerModel" required maxLength={200} defaultValue={selected?.providerModel} disabled={pending} placeholder="deepseek-flash" className="font-mono text-xs" /></label>
    <label className="block space-y-2"><span className="text-xs text-muted-foreground">Context window</span><Input name="contextWindow" type="number" min={1} max={2147483647} step={1} required defaultValue={selected?.contextWindow} disabled={pending} /></label>
    <div className="grid grid-cols-2 gap-3">{[["inputPricePerMillion", "Input cost / 1M"], ["outputPricePerMillion", "Output cost / 1M"]].map(([key, label]) => <label key={key} className="space-y-2"><span className="text-xs text-muted-foreground">{label}</span><Input name={key} inputMode="decimal" required defaultValue={selected?.[key as "inputPricePerMillion" | "outputPricePerMillion"] ?? "0"} disabled={pending} /></label>)}</div>
    <div className="flex flex-wrap gap-5 text-xs"><label className="flex items-center gap-2"><input name="enabled" type="checkbox" defaultChecked={selected?.enabled ?? true} disabled={pending} className="size-4 accent-[var(--primary)]" />Enabled</label><label className="flex items-center gap-2"><input name="preferred" type="checkbox" defaultChecked={selected?.preferred ?? false} disabled={pending} className="size-4 accent-[var(--primary)]" />Preferred channel</label></div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Button loading={pending} type="submit" disabled={pending}>{pending ? "Saving…" : "Save model route"}</Button>
  </form>;
}
