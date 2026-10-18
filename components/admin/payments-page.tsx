"use client";
import { useState } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import type { AdminPaymentsData, AdminPaymentQuery } from "@/lib/admin-types";
import { formatCny, formatCount } from "@/lib/analytics-format";
import { useAnalytics } from "@/components/dashboard/analytics/use-analytics";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { DataPagination } from "@/components/dashboard/analytics/pagination";
import { AdminDataTable, AdminEmpty, AdminPageHeading, AdminStatus } from "./admin-ui";
import { AdminFilters, AdminFilterInput, AdminFilterSelect, AdminLoading, AdminTimestamp } from "./data-ui";

export function AdminPaymentsPage({ initialData }: { initialData: AdminPaymentsData }) {
  const { data, query, loading, error, load, retry } = useAnalytics(initialData, initialData.query, "/api/admin/payments");
  const [from, setFrom] = useState(query.from ?? ""), [to, setTo] = useState(query.to ?? "");
  const [userId, setUserId] = useState(query.userId ?? ""), [method, setMethod] = useState(query.method ?? ""), [status, setStatus] = useState(query.status ?? "");
  function apply() { void load({ page: 1, pageSize: query.pageSize, from: from || undefined, to: to || undefined, userId: userId.trim() || undefined, method: method as AdminPaymentQuery["method"] || undefined, status: status as AdminPaymentQuery["status"] || undefined }); }
  function reset() { setFrom(""); setTo(""); setUserId(""); setMethod(""); setStatus(""); void load({ page: 1, pageSize: query.pageSize }); }
  return <div className="space-y-6">
    <AdminPageHeading title="Payments" description="Review Alipay and WeChat Pay orders and confirmed payments." />
    <AdminFilters onApply={apply} onReset={reset} loading={loading}>
      <AdminFilterInput label="From (UTC)" type="date" value={from} onChange={setFrom} /><AdminFilterInput label="To (UTC)" type="date" value={to} onChange={setTo} />
      <AdminFilterInput label="User ID" placeholder="All users" value={userId} onChange={setUserId} />
      <AdminFilterSelect label="Provider" value={method} onChange={setMethod} options={[["", "All providers"], ["ALIPAY", "Alipay"], ["WECHAT", "WeChat Pay"]]} />
      <AdminFilterSelect label="Status" value={status} onChange={setStatus} options={[["", "All statuses"], ["PENDING", "Pending"], ["PAID", "Paid"], ["FAILED", "Failed"], ["CLOSED", "Closed"], ["REFUNDED", "Refunded"]]} />
    </AdminFilters>
    <p className="text-[11px] text-muted-foreground">Default: last 30 days by order creation date · CNY · {formatCount(data.pagination.total)} orders</p>
    {loading ? <AdminLoading /> : error ? <DataError message={error} onRetry={retry} /> : <>
      <AdminDataTable label="Payment orders" columns={[{ label: "User" }, { label: "Order ID" }, { label: "Provider" }, { label: "Amount", numeric: true }, { label: "Status" }, { label: "Paid At (UTC)" }, { label: "Created At (UTC)" }]} minWidth={1040}>
        {!data.payments.length ? <AdminEmpty columns={7} onReset={reset} /> : data.payments.map((payment) => <TableRow key={payment.id}>
          <TableCell><p className="font-medium">{payment.user.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{payment.user.email}</p></TableCell>
          <TableCell className="font-mono text-[11px]">{payment.orderId}</TableCell><TableCell>{payment.method === "ALIPAY" ? "Alipay" : "WeChat Pay"}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCny(payment.amount)}</TableCell><TableCell><AdminStatus status={payment.status} /></TableCell>
          <TableCell><AdminTimestamp value={payment.paidAt} /></TableCell><TableCell><AdminTimestamp value={payment.createdAt} /></TableCell>
        </TableRow>)}
      </AdminDataTable>
      <DataPagination pagination={data.pagination} label="Payment orders" onChange={(page) => void load({ ...query, page })} />
    </>}
  </div>;
}
