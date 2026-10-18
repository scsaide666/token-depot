"use client";
import { useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { DialogFooter } from "@/components/ui/dialog";
import { useAnalytics } from "@/components/dashboard/analytics/use-analytics";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { DataPagination } from "@/components/dashboard/analytics/pagination";
import { adminRequest } from "@/lib/admin-client";
import { formatCny, formatCount } from "@/lib/analytics-format";
import { providerNames } from "@/lib/model-types";
import type { ChannelInput } from "@/lib/provider-schemas";
import type { AttemptRecord, ChannelRecord, HealthWindow, ProviderPageData } from "@/lib/provider-types";
import type { PageInfo } from "@/lib/analytics-types";
import { AdminActionMenu, AdminDataTable, AdminEmpty, AdminModal, AdminPageHeading, AdminSearch, AdminStatus } from "./admin-ui";
import { AdminFilters, AdminFilterSelect, AdminLoading, AdminTimestamp } from "./data-ui";
import { ProviderForm } from "./provider-form";
import { ProviderBindings, type BindingsData } from "./provider-bindings";

type Mode = "create" | "edit" | "models" | "attempts" | "enable" | "disable";
type AttemptsData = { attempts: AttemptRecord[]; pagination: PageInfo };
const columns = [{ label: "Channel" }, { label: "Status" }, { label: "Avg. latency", numeric: true }, { label: "Success", numeric: true }, { label: "Errors", numeric: true },
  { label: "Attempts", numeric: true }, { label: "Provider cost", numeric: true }, { label: "Priority / Weight", numeric: true }, { label: "Actions" }];
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
export function AdminProvidersPage({ initialData }: { initialData: ProviderPageData }) {
  const { data, query, loading, error: loadError, load, retry } = useAnalytics(initialData, initialData.query, "/api/admin/providers");
  const [search, setSearch] = useState(query.search ?? ""), [provider, setProvider] = useState<string>(query.provider ?? "");
  const [window, setWindow] = useState<HealthWindow>(query.window);
  const [selected, setSelected] = useState<ChannelRecord>(), [mode, setMode] = useState<Mode>("create"), [open, setOpen] = useState(false), [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false), [panelLoading, setPanelLoading] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [bindings, setBindings] = useState<BindingsData>(), [attempts, setAttempts] = useState<AttemptsData>();
  const returnFocusRef = useRef<HTMLElement | null>(null), generation = useRef(0);
  function apply() { void load({ page: 1, pageSize: query.pageSize, window, search: search.trim() || undefined, provider: provider as ProviderPageData["query"]["provider"] || undefined }); }
  function reset() { setSearch(""); setProvider(""); void load({ page: 1, pageSize: query.pageSize, window }); }
  function close(value: boolean) { if (!pending) { setOpen(value); if (!value) generation.current++; } }
  async function loadPanel(channel: ChannelRecord, nextMode: "models" | "attempts", page = 1) {
    const token = ++generation.current; setPanelLoading(true); setError("");
    try {
      const result = await adminRequest<BindingsData | AttemptsData>(`/api/admin/providers/${channel.id}/${nextMode}?page=${page}&pageSize=10`);
      if (token !== generation.current) return;
      if (nextMode === "models") setBindings(result as BindingsData); else setAttempts(result as AttemptsData);
    } catch (failure) { if (token === generation.current) setError(failure instanceof Error ? failure.message : "Unable to load channel data."); }
    finally { if (token === generation.current) setPanelLoading(false); }
  }
  function show(next: Mode, channel: ChannelRecord | undefined, trigger: HTMLButtonElement | null) {
    generation.current++; returnFocusRef.current = trigger; setMode(next); setSelected(channel); setRevision(v => v + 1); setError(""); setBindings(undefined); setAttempts(undefined); setOpen(true);
    if (channel && (next === "models" || next === "attempts")) void loadPanel(channel, next);
  }
  async function save(fields: ChannelInput | Partial<Omit<ChannelInput, "code" | "provider">>) {
    if (pending) return; setPending(true); setNotice("");
    try { await adminRequest(selected ? `/api/admin/providers/${selected.id}` : "/api/admin/providers", selected ? "PATCH" : "POST", fields);
      setOpen(false); setNotice(selected ? "Channel changes saved." : "Channel created. Add compatible model bindings to start routing."); await load({ ...query, page: selected ? query.page : 1 }); }
    finally { setPending(false); }
  }
  async function toggle() {
    setError("");
    try { await save({ enabled: mode === "enable" }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update channel."); }
  }
  return <div className="space-y-7">
    <AdminPageHeading title="Providers" description="Monitor upstream health and manage compatible routing channels." action={<Button onClick={e => show("create", undefined, e.currentTarget)}><Plus className="size-4" aria-hidden="true" />Create Channel</Button>} />
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    <AdminFilters onApply={apply} onReset={reset} loading={loading}><AdminSearch label="Search channels" value={search} onChange={setSearch} placeholder="Search channel name or code" />
      <AdminFilterSelect label="Provider" value={provider} onChange={setProvider} options={[["", "All providers"], ...Object.entries(providerNames)]} />
      <AdminFilterSelect label="Health window" value={window} onChange={v => setWindow(v as HealthWindow)} options={[["5m", "Last 5 minutes"], ["1h", "Last hour"], ["24h", "Last 24 hours"]]} />
    </AdminFilters>
    <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground"><p>Health reflects real attempts · Idle channels have no confirmed samples</p><Button loading={loading} variant="ghost" size="sm" disabled={loading} onClick={() => void retry()}><RefreshCw className="size-3.5" aria-hidden="true" />Refresh status</Button></div>
    {loading ? <AdminLoading /> : loadError ? <DataError message={loadError} onRetry={retry} /> : <>
      <AdminDataTable label="Provider channels" columns={columns} minWidth={1130}>
        {!data.channels.length ? <AdminEmpty columns={9} onReset={reset} /> : data.channels.map(channel => {
          const stats = channel.windows[query.window];
          return <TableRow key={channel.id}><TableCell><p className="font-medium">{channel.name}</p><p className="mt-1.5 text-[11px] text-muted-foreground">{providerNames[channel.provider]}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{channel.code}</p></TableCell>
            <TableCell><AdminStatus status={channel.health} /><p className="mt-1.5 text-[10px] text-muted-foreground">{!channel.enabled ? "Disabled" : !channel.configured ? "Not configured" : channel.circuitState === "CLOSED" ? "Circuit closed" : channel.circuitState === "OPEN" ? "Circuit open" : "Probe in progress"}</p></TableCell>
            <TableCell className="text-right text-xs tabular-nums">{stats.averageLatency === null ? "—" : `${stats.averageLatency.toLocaleString()}ms`}</TableCell>
            <TableCell className="text-right text-xs tabular-nums">{percent(stats.successRate)}</TableCell><TableCell className="text-right text-xs text-muted-foreground tabular-nums">{percent(stats.errorRate)}</TableCell>
            <TableCell className="text-right text-xs tabular-nums">{formatCount(stats.requests)}</TableCell><TableCell className="text-right text-xs tabular-nums">{formatCny(stats.cost)}{stats.unknownCosts !== "0" && <p className="mt-1 text-[10px] text-muted-foreground">{formatCount(stats.unknownCosts)} pending reconciliation</p>}</TableCell>
            <TableCell className="text-right text-xs tabular-nums">{channel.priority} / {channel.weight}</TableCell><TableCell><AdminActionMenu name={channel.name} items={[{ id: "edit" as const, label: "Edit channel" }, { id: "models" as const, label: "Model routes" }, { id: "attempts" as const, label: "Upstream attempts" }, { id: channel.enabled ? "disable" as const : "enable" as const, label: channel.enabled ? "Disable" : "Enable", separator: true, destructive: channel.enabled }]} onAction={(action, trigger) => show(action, channel, trigger)} /></TableCell></TableRow>;
        })}
      </AdminDataTable><DataPagination pagination={data.pagination} label="Channels" onChange={page => void load({ ...query, page })} />
    </>}
    <p className="text-[11px] leading-relaxed text-muted-foreground">Provider costs use immutable channel rate snapshots. Unknown usage stays pending reconciliation. Weights apply to equally ranked channels; health and priority take precedence.</p>
    <AdminModal open={open} onOpenChange={close} title={mode === "create" ? "Create channel" : mode === "edit" ? "Edit channel" : mode === "models" ? "Model routes" : mode === "attempts" ? "Upstream attempts" : mode === "enable" ? "Enable channel?" : "Disable channel?"}
      description={mode === "models" ? `Compatible routes for ${selected?.name ?? "this channel"}.` : mode === "attempts" ? "One root request ID links each attempt to a single wallet settlement." : mode === "disable" ? "New requests will stop selecting this channel. In-flight attempts keep their original settlement." : "Configure server references, routing priority and capacity limits."}
      returnFocusRef={returnFocusRef} focusId={mode === "create" || mode === "edit" ? "admin-channel-name" : "admin-provider-close"}>
      {mode === "create" || mode === "edit" ? <ProviderForm key={revision} channel={selected} pending={pending} onSave={save} onCancel={() => close(false)} /> : mode === "enable" || mode === "disable" ? <>
        <p className="text-sm font-medium">{selected?.name}</p>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<DialogFooter><Button id="admin-provider-close" variant="secondary" disabled={pending} onClick={() => close(false)}>Cancel</Button><Button disabled={pending} onClick={() => void toggle()} variant={mode === "disable" ? "destructive" : "default"} className={mode === "disable" ? "bg-destructive/8 text-destructive hover:bg-destructive/12" : ""}>{pending ? "Saving…" : mode === "enable" ? "Enable channel" : "Disable channel"}</Button></DialogFooter>
      </> : <>
        {panelLoading ? <AdminLoading /> : error ? <DataError message={error} onRetry={() => selected && void loadPanel(selected, mode)} /> : mode === "models" && selected && bindings ? <ProviderBindings channel={selected} data={bindings} onLoad={page => loadPanel(selected, "models", page)} onSaved={async () => { await loadPanel(selected, "models"); await load(query); }} /> : attempts ? <div className="max-h-[60dvh] space-y-4 overflow-y-auto px-1">
          <AdminDataTable label="Upstream attempts" columns={[{ label: "Request" }, { label: "Result" }, { label: "Cost" }, { label: "Time" }]} minWidth={640}>
            {!attempts.attempts.length && <TableRow><TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No upstream attempts yet.</TableCell></TableRow>}
            {attempts.attempts.map(attempt => <TableRow key={attempt.id}><TableCell><p className="font-mono text-[10px]">{attempt.requestId}</p><p className="mt-1 text-[10px] text-muted-foreground">Attempt {attempt.attemptNumber} · {attempt.latencyMs}ms</p></TableCell><TableCell><AdminStatus status={attempt.status} /><p className="mt-1 text-[10px] text-muted-foreground">{attempt.errorCode ?? attempt.executionState}</p></TableCell><TableCell className="text-xs tabular-nums">{attempt.providerCost === null ? "Pending reconciliation" : formatCny(attempt.providerCost)}{attempt.costStatus === "NOT_INCURRED" && <p className="mt-1 text-[10px] text-muted-foreground">Not incurred</p>}</TableCell><TableCell><AdminTimestamp value={attempt.createdAt} /></TableCell></TableRow>)}
          </AdminDataTable><DataPagination pagination={attempts.pagination} label="Attempts" onChange={page => selected && void loadPanel(selected, "attempts", page)} />
        </div> : null}
        <DialogFooter><Button id="admin-provider-close" variant="secondary" onClick={() => close(false)}>Close</Button></DialogFooter>
      </>}
    </AdminModal>
  </div>;
}
