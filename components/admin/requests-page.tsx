"use client";
import { useState } from "react";
import type { AdminRequestsData, AdminRequestQuery } from "@/lib/admin-types";
import { useAnalytics } from "@/components/dashboard/analytics/use-analytics";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { DataPagination } from "@/components/dashboard/analytics/pagination";
import { AdminPageHeading } from "./admin-ui";
import { AdminFilters, AdminFilterInput, AdminFilterSelect, AdminFinancialSummary, AdminLoading } from "./data-ui";
import { AdminRequestsTable } from "./requests-table";

export function AdminRequestsPage({ initialData }: { initialData: AdminRequestsData }) {
  const { data, query, loading, error, load, retry } = useAnalytics(initialData, initialData.query, "/api/admin/requests");
  const [from, setFrom] = useState(query.from ?? ""), [to, setTo] = useState(query.to ?? "");
  const [userId, setUserId] = useState(query.userId ?? ""), [modelId, setModelId] = useState(query.modelId ?? ""), [status, setStatus] = useState(query.status ?? "");
  function apply() { void load({ page: 1, pageSize: query.pageSize, from: from || undefined, to: to || undefined, userId: userId.trim() || undefined, modelId: modelId.trim() || undefined, status: status as AdminRequestQuery["status"] || undefined }); }
  function reset() { setFrom(""); setTo(""); setUserId(""); setModelId(""); setStatus(""); void load({ page: 1, pageSize: query.pageSize }); }
  return <div className="space-y-6">
    <AdminPageHeading title="Requests" description="Inspect API activity, token usage and settled costs." />
    <AdminFilters onApply={apply} onReset={reset} loading={loading}>
      <AdminFilterInput label="From (UTC)" type="date" value={from} onChange={setFrom} />
      <AdminFilterInput label="To (UTC)" type="date" value={to} onChange={setTo} />
      <AdminFilterInput label="User ID" placeholder="All users" value={userId} onChange={setUserId} />
      <AdminFilterInput label="Model ID" placeholder="All models · slug or ID" value={modelId} onChange={setModelId} />
      <AdminFilterSelect label="Status" value={status} onChange={setStatus} options={[["", "All statuses"], ["PENDING", "Pending"], ["SUCCESS", "Success"], ["FAILED", "Failed"]]} />
    </AdminFilters>
    <p className="text-[11px] text-muted-foreground">Default: last 30 days. Dates include the selected end date. Obtain a user ID from Users → View.</p>
    {loading ? <AdminLoading /> : error ? <DataError message={error} onRetry={retry} /> : <>
      <AdminFinancialSummary stats={data.stats} />
      <AdminRequestsTable requests={data.requests} onReset={reset} />
      <DataPagination pagination={data.pagination} label="Request history" onChange={(page) => void load({ ...query, page })} />
    </>}
  </div>;
}
