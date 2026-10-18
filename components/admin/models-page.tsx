"use client";
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { TableCell, TableRow } from "@/components/ui/table";
import { useAnalytics } from "@/components/dashboard/analytics/use-analytics";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { DataPagination } from "@/components/dashboard/analytics/pagination";
import { modelContext, modelPrice, providerNames, type AdminModelRecord } from "@/lib/model-types";
import type { AdminModelsData, AdminModelQuery } from "@/lib/admin-types";
import { formatCny, formatCount } from "@/lib/analytics-format";
import { modelRequest } from "@/lib/model-client";
import type { ModelInput } from "@/lib/model-schemas";
import { AdminActionMenu, AdminDataTable, AdminEmpty, AdminModal, AdminPageHeading, AdminSearch, AdminStatus } from "./admin-ui";
import { AdminFilters, AdminFilterInput, AdminFilterSelect, AdminLoading } from "./data-ui";
import { AdminModelForm } from "./model-form";

type Action = "edit" | "disable" | "enable";
const columns = [{ label: "Model" }, { label: "Provider" }, { label: "Provider Rate", numeric: true }, { label: "Selling Rate", numeric: true }, { label: "Markup", numeric: true }, { label: "Margin / 1M", numeric: true },
  { label: "Requests", numeric: true }, { label: "Tokens", numeric: true }, { label: "Revenue", numeric: true }, { label: "Provider Cost", numeric: true }, { label: "Profit", numeric: true }, { label: "Status" }, { label: "Actions" }];

export function AdminModelsPage({ initialData }: { initialData: AdminModelsData }) {
  const { data, query, loading, error: loadError, load, retry } = useAnalytics(initialData, initialData.query, "/api/admin/models");
  const [search, setSearch] = useState(query.search ?? ""), [provider, setProvider] = useState<string>(query.provider ?? "");
  const [from, setFrom] = useState(query.from ?? ""), [to, setTo] = useState(query.to ?? "");
  const [selected, setSelected] = useState<AdminModelRecord>(), [mode, setMode] = useState<"create" | Action>("create"), [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0), [pending, setPending] = useState(false), [requestError, setRequestError] = useState(""), [notice, setNotice] = useState("");
  const returnFocusRef = useRef<HTMLElement | null>(null);
  function apply() { void load({ page: 1, pageSize: query.pageSize, search: search.trim() || undefined, provider: provider as AdminModelQuery["provider"] || undefined, from: from || undefined, to: to || undefined }); }
  function reset() { setSearch(""); setProvider(""); setFrom(""); setTo(""); void load({ page: 1, pageSize: query.pageSize }); }
  function show(next: "create" | Action, model: AdminModelRecord | undefined, trigger: HTMLButtonElement | null) { returnFocusRef.current = trigger; setMode(next); setSelected(model); setRevision((value) => value + 1); setRequestError(""); setOpen(true); }
  function close(value: boolean) { if (!pending) setOpen(value); }
  async function save(fields: ModelInput) {
    if (pending) return; setPending(true); setNotice("");
    try {
      await modelRequest(selected ? `/api/admin/models/${selected.id}` : "/api/admin/models", selected ? "PATCH" : "POST", fields);
      setOpen(false); setNotice(selected ? "Model changes saved." : "Model created."); await load({ ...query, page: selected ? query.page : 1 });
    } finally { setPending(false); }
  }
  async function toggle() {
    if (!selected || pending) return; setPending(true); setRequestError(""); setNotice("");
    try {
      await modelRequest(`/api/admin/models/${selected.id}`, "PATCH", { enabled: mode === "enable" });
      setOpen(false); setNotice(mode === "enable" ? "Model enabled in the public catalog." : "Model disabled and removed from the public catalog."); await load(query);
    } catch (failure) { setRequestError(failure instanceof Error ? failure.message : "Unable to update model availability."); }
    finally { setPending(false); }
  }
  const confirmation = mode === "enable" || mode === "disable";
  function rates(input: string, output: string) { return <div className="space-y-1.5 text-xs tabular-nums"><p><span className="mr-2 text-[10px] text-muted-foreground">In</span>{modelPrice(input)}</p><p><span className="mr-2 text-[10px] text-muted-foreground">Out</span>{modelPrice(output)}</p></div>; }
  return <div className="space-y-7">
    <AdminPageHeading title="Models" description="Manage model availability, prices and real usage statistics." action={<Button onClick={(event) => show("create", undefined, event.currentTarget)}><Plus className="size-4" aria-hidden="true" />Create Model</Button>} />
    {notice && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{notice}</p>}
    <AdminFilters onApply={apply} onReset={reset} loading={loading}>
      <AdminSearch label="Search models" placeholder="Search model name or ID" value={search} onChange={setSearch} />
      <AdminFilterSelect label="Provider" value={provider} onChange={setProvider} options={[["", "All providers"], ...Object.entries(providerNames)]} />
      <AdminFilterInput label="From (UTC)" type="date" value={from} onChange={setFrom} /><AdminFilterInput label="To (UTC)" type="date" value={to} onChange={setTo} />
    </AdminFilters>
    <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground"><p>{formatCount(data.pagination.total)} models · {query.from || query.to ? "Selected date range" : "Lifetime statistics"}</p><p>Rates: CNY / 1M tokens · Totals: settled API costs</p></div>
    {loading ? <AdminLoading /> : loadError ? <DataError message={loadError} onRetry={retry} /> : <>
      <AdminDataTable label="Model catalog" columns={columns} minWidth={1840}>
        {!data.models.length ? <AdminEmpty columns={13} onReset={reset} /> : data.models.map((model) => <TableRow key={model.id} className="hover:bg-background/40">
          <TableCell><p className="font-medium">{model.name}</p><p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{model.slug}</p><p className="mt-1 text-[11px] text-muted-foreground">{modelContext(model.contextWindow)} context</p></TableCell>
          <TableCell><p className="text-xs">{model.provider}</p><p className="mt-1.5 max-w-[150px] break-all font-mono text-[10px] text-muted-foreground">{model.providerModel}</p></TableCell>
          <TableCell className="text-right">{rates(model.inputCostPerMillion, model.outputCostPerMillion)}</TableCell><TableCell className="text-right">{rates(model.inputPricePerMillion, model.outputPricePerMillion)}</TableCell>
          <TableCell className="text-right text-xs tabular-nums">{model.markupMultiplier}×</TableCell><TableCell className="text-right">{rates(model.inputMarginPerMillion, model.outputMarginPerMillion)}<p className="mt-2 text-[10px] text-muted-foreground">{model.marginPercent === null ? "—" : `${model.marginPercent}%`}</p></TableCell>
          <TableCell className="text-right tabular-nums">{formatCount(model.stats.requests)}</TableCell><TableCell className="text-right tabular-nums">{formatCount(model.stats.tokens)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCny(model.stats.revenue)}</TableCell><TableCell className="text-right text-muted-foreground tabular-nums">{formatCny(model.stats.providerCost)}</TableCell><TableCell className="text-right tabular-nums">{formatCny(model.stats.profit)}{model.stats.unknownCosts !== "0" && <p className="mt-1 text-[10px] text-muted-foreground">{formatCount(model.stats.unknownCosts)} costs unavailable</p>}</TableCell>
          <TableCell><AdminStatus status={model.enabled ? "Enabled" : "Disabled"} /></TableCell><TableCell><AdminActionMenu name={model.name} items={[{ id: "edit", label: "Edit" }, { id: model.enabled ? "disable" : "enable", label: model.enabled ? "Disable" : "Enable", destructive: model.enabled, separator: true }]} onAction={(action: Action, trigger) => show(action, model, trigger)} /></TableCell>
        </TableRow>)}
      </AdminDataTable>
      <DataPagination pagination={data.pagination} label="Models" onChange={(page) => void load({ ...query, page })} />
    </>}
    <AdminModal open={open} onOpenChange={close} title={mode === "create" ? "Create model" : mode === "edit" ? "Edit model" : mode === "enable" ? "Enable model?" : "Disable model?"} description={confirmation ? mode === "enable" ? "This model will be visible in the public catalog." : "This model will no longer appear in public or user model catalogs." : "Configure provider costs and markup. Customers see the calculated selling prices."} returnFocusRef={returnFocusRef} focusId={confirmation ? "admin-model-cancel" : "admin-model-name"}>
      {confirmation && selected ? <><div className="rounded-md border border-border bg-secondary px-4 py-3"><p className="text-sm font-medium">{selected.name}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selected.slug}</p></div>{requestError && <p role="alert" className="text-xs text-destructive">{requestError}</p>}<DialogFooter><Button id="admin-model-cancel" variant="secondary" disabled={pending} onClick={() => close(false)}>Cancel</Button><Button loading={pending} variant={mode === "disable" ? "destructive" : "default"} disabled={pending} className={mode === "disable" ? "bg-destructive/8 text-destructive hover:bg-destructive/12" : ""} onClick={toggle}>{pending ? "Saving…" : mode === "disable" ? "Disable model" : "Enable model"}</Button></DialogFooter></> : <AdminModelForm key={revision} model={selected} pending={pending} onSave={save} onCancel={() => close(false)} />}
    </AdminModal>
  </div>;
}
