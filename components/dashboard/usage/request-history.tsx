"use client";
import { ChevronDown } from "lucide-react";
import type { FilterOption, UsageData, UsageQuery } from "@/lib/analytics-types";
import { DataPagination } from "../analytics/pagination";
import { RequestTable } from "../analytics/request-table";
import { ConsoleTableSkeleton } from "../console-primitives";
import { ResponsiveFilters } from "@/components/ui/responsive-filters";
function HistoryFilter({ label, value, options, onChange }: { label: string; value?: string; options: FilterOption[]; onChange: (value: string) => void }) {
  return <label className="min-w-0 space-y-1.5 sm:w-[180px]"><span className="block text-[11px] text-muted-foreground">{label}</span><span className="relative block">
    <select aria-label={`Filter by ${label}`} data-filter-active={!!value || undefined} value={value ?? "all"} onChange={(event) => onChange(event.target.value)} className="h-10 w-full min-w-0 cursor-pointer appearance-none truncate rounded-[10px] border border-border bg-card pr-7 pl-2.5 text-xs text-foreground outline-none transition-colors duration-200 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 sm:pl-3">
      <option value="all">All</option>{value && !options.some((option) => option.value === value) && <option value={value}>Selected {label.toLowerCase()}</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 size-3 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
  </span></label>;
}
export function UsageFilters({ data, query, onChange }: { data: UsageData; query: UsageQuery; onChange: (query: UsageQuery) => void }) {
  const hasFilters = !!(query.modelId || query.apiKeyId || query.status);
  return <div className="console-filterbar console-usage-filters">
    <ResponsiveFilters activeCount={Number(!!query.modelId) + Number(!!query.apiKeyId) + Number(!!query.status)}>
      <HistoryFilter label="Model" value={query.modelId} options={data.filters.models} onChange={(modelId) => onChange({ ...query, modelId: modelId === "all" ? undefined : modelId, page: 1 })} />
      <HistoryFilter label="API Key" value={query.apiKeyId} options={data.filters.apiKeys} onChange={(apiKeyId) => onChange({ ...query, apiKeyId: apiKeyId === "all" ? undefined : apiKeyId, page: 1 })} />
      <HistoryFilter label="Status" value={query.status} options={[{ value: "SUCCESS", label: "Success" }, { value: "FAILED", label: "Failed" }, { value: "PENDING", label: "Pending" }]} onChange={(status) => onChange({ ...query, status: status === "all" ? undefined : status as UsageQuery["status"], page: 1 })} />
      {hasFilters && <button type="button" className="console-text-link" onClick={() => onChange({ range: query.range, page: 1, pageSize: query.pageSize })}>Clear filters</button>}
    </ResponsiveFilters>
  </div>;
}
export function RequestHistory({ data, onPageChange, loading = false }: { data: UsageData; onPageChange: (page: number) => void; loading?: boolean }) {
  return <section aria-labelledby="request-history-title" className="console-panel"><div className="console-panel-heading"><h2 id="request-history-title">Request History</h2><p>Requests in the selected view. Times are UTC.</p></div>{loading ? <ConsoleTableSkeleton label="Loading request history" rows={data.requests.length || 3} /> : <RequestTable records={data.requests} label="Request history" />}<DataPagination pagination={data.pagination} label="Request history" disabled={loading} onChange={onPageChange} /></section>;
}
