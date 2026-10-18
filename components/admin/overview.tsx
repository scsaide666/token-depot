"use client";
import { useState } from "react";
import Link from "next/link";
import { SegmentedControl } from "@/components/dashboard/usage/segmented-control";
import { UsageLineChart } from "@/components/dashboard/usage/usage-line-chart";
import { useAnalytics } from "@/components/dashboard/analytics/use-analytics";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { TableCell, TableRow } from "@/components/ui/table";
import type { AdminOverviewData } from "@/lib/admin-types";
import { formatCny, formatCount, requestDate } from "@/lib/analytics-format";
import type { UsageMetric } from "@/lib/usage-demo-data";
import { AdminDataTable, AdminPageHeading, AdminStatus } from "./admin-ui";
import { AdminFilters, AdminFilterInput, AdminFinancialSummary, AdminLoading, AdminTimestamp } from "./data-ui";
import { AdminRequestsTable } from "./requests-table";

export function AdminOverview({ initialData }: { initialData: AdminOverviewData }) {
  const { data, query, loading, error, load, retry } = useAnalytics(initialData, initialData.query, "/api/admin/overview");
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  const [from, setFrom] = useState(query.from ?? ""), [to, setTo] = useState(query.to ?? "");
  const metrics = [{ label: "Total Users", value: formatCount(data.totalUsers) }, { label: "Active Users", value: formatCount(data.activeUsers) },
    { label: "Requests Today", value: formatCount(data.today.requests) }, { label: "Tokens Today", value: formatCount(data.today.tokens) },
    { label: "Revenue Today", value: formatCny(data.today.revenue) }, { label: "Provider Cost Today", value: formatCny(data.today.providerCost) }, { label: "Gross Profit Today", value: formatCny(data.today.profit) }];
  function reset() { setFrom(""); setTo(""); void load({}); }
  return <div className="space-y-6">
    <AdminPageHeading title="Overview" description="A clear view of platform activity, account health and profitability." action={<span className="text-xs text-muted-foreground">UTC · Live statistics</span>} />
    <dl className="admin-metrics grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-4">{metrics.map((item) => <div key={item.label} className="admin-metric min-w-0 px-5 py-6 sm:px-6"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-3 text-[24px] leading-tight font-semibold tracking-[-0.04em] break-all tabular-nums sm:text-[28px]">{item.value}</dd></div>)}</dl>
    {data.today.unknownCosts !== "0" && <p className="text-[11px] text-muted-foreground">{formatCount(data.today.unknownCosts)} requests today have unavailable costs. Financial totals include known settled costs only.</p>}
    <AdminFilters loading={loading} onApply={() => void load({ from: from || undefined, to: to || undefined })} onReset={reset}>
      <AdminFilterInput label="From (UTC)" type="date" value={from} onChange={setFrom} /><AdminFilterInput label="To (UTC)" type="date" value={to} onChange={setTo} />
    </AdminFilters>
    {loading ? <AdminLoading /> : error ? <DataError message={error} onRetry={retry} /> : <>
      <section aria-labelledby="admin-usage-heading" className="min-w-0 rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div><h2 id="admin-usage-heading" className="ui-section-title">Usage Chart</h2><p className="mt-1 text-xs text-muted-foreground">{requestDate(data.from)} – {requestDate(data.points.at(-1)?.date ?? data.to)} · UTC</p></div><SegmentedControl label="Admin chart metric" value={metric} options={[{ value: "requests", label: "Requests" }, { value: "tokens", label: "Tokens" }, { value: "spend", label: "Revenue" }]} onChange={setMetric} /></div>
        <UsageLineChart points={data.points} metric={metric} />
        <div className="mt-5 border-t border-border/60 pt-5"><AdminFinancialSummary stats={data.selected} /></div>
      </section>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
        <section aria-labelledby="admin-recent-users-heading" className="min-w-0"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="admin-recent-users-heading" className="ui-section-title">Recent Users</h2><Link href="/admin/users" className="auth-link text-xs">View all users</Link></div>
          <AdminDataTable label="Recent users" columns={[{ label: "User" }, { label: "Status" }, { label: "Created" }]} minWidth={380}>
            {!data.recentUsers.length ? <TableRow><TableCell colSpan={3} className="py-10 text-center text-muted-foreground">No users yet</TableCell></TableRow> : data.recentUsers.map((user) => <TableRow key={user.id}><TableCell><p className="font-medium">{user.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{user.email}</p></TableCell><TableCell><AdminStatus status={user.status} /></TableCell><TableCell><AdminTimestamp value={user.createdAt} /></TableCell></TableRow>)}
          </AdminDataTable>
        </section>
        <section aria-labelledby="admin-recent-requests-heading" className="min-w-0"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="admin-recent-requests-heading" className="ui-section-title">Recent Requests</h2><Link href="/admin/requests" className="auth-link text-xs">View all requests</Link></div><AdminRequestsTable requests={data.recentRequests} compact onReset={reset} /></section>
      </div>
    </>}
    <p className="text-[11px] leading-relaxed text-muted-foreground">Today’s metrics use the current UTC calendar day. The chart and period totals default to seven days. Revenue is settled API usage; gross profit is revenue minus provider cost.</p>
  </div>;
}
