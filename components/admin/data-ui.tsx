"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FinancialStats } from "@/lib/admin-types";
import { formatCny, formatCount, requestDate, requestTime } from "@/lib/analytics-format";

export function AdminFilters({ children, onApply, onReset, loading }: { children: ReactNode; onApply: () => void; onReset: () => void; loading: boolean }) {
  return <form aria-label="Table filters" onSubmit={(event) => { event.preventDefault(); onApply(); }} className="flex flex-wrap items-end gap-3">
    {children}<Button type="submit" size="sm" loading={loading} disabled={loading} className="h-11">{loading ? "Updating…" : "Apply filters"}</Button>
    <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={onReset} className="h-11 text-muted-foreground">Reset</Button>
  </form>;
}
export function AdminFilterInput({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: "text" | "date"; placeholder?: string }) {
  return <label className="min-w-0 flex-1 basis-40 space-y-2 sm:max-w-[220px]"><span className="block text-[11px] text-muted-foreground">{label}</span><Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={120} className="h-11 rounded-sm sm:text-[13px]" /></label>;
}
export function AdminFilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="min-w-0 flex-1 basis-36 space-y-2 sm:max-w-[190px]"><span className="block text-[11px] text-muted-foreground">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full min-w-0 rounded-sm border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 sm:text-[13px]">{options.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>;
}
export function AdminLoading() {
  return <div role="status" aria-label="Loading admin data" className="overflow-hidden rounded-lg border border-border bg-card p-6"><span className="sr-only">Loading admin data…</span><div aria-hidden="true" className="space-y-4">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" />)}</div></div>;
}
export function AdminFinancialSummary({ stats }: { stats: FinancialStats }) {
  return <div className="space-y-3"><dl className="flex flex-wrap gap-x-8 gap-y-4 text-xs">{[["Requests", formatCount(stats.requests)], ["Tokens", formatCount(stats.tokens)], ["Revenue", formatCny(stats.revenue)], ["Provider cost", formatCny(stats.providerCost)], ["Gross profit", formatCny(stats.profit)]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1.5 max-w-[250px] font-medium break-all tabular-nums">{value}</dd></div>)}</dl>
    {stats.unknownCosts !== "0" && <p className="text-[11px] text-muted-foreground">{formatCount(stats.unknownCosts)} requests have unavailable costs. Financial totals include known settled costs only.</p>}
  </div>;
}
export function AdminTimestamp({ value }: { value: string | null }) {
  return value ? <div className="text-xs text-muted-foreground tabular-nums"><p>{requestDate(value)}</p><p className="mt-1 text-[10px]">{requestTime(value)}</p></div> : <span className="text-muted-foreground">—</span>;
}
