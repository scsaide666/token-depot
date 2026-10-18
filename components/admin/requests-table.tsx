"use client";
import { TableCell, TableRow } from "@/components/ui/table";
import type { AdminRequestRecord } from "@/lib/admin-types";
import { formatCny, formatCount } from "@/lib/analytics-format";
import { AdminDataTable, AdminEmpty, AdminStatus } from "./admin-ui";
import { AdminTimestamp } from "./data-ui";

export function AdminRequestsTable({ requests, compact = false, onReset = () => {} }: { requests: AdminRequestRecord[]; compact?: boolean; onReset?: () => void }) {
  const columns = [{ label: "User" }, { label: "Model" }, { label: "Input", numeric: true }, { label: "Output", numeric: true }, { label: "User Cost", numeric: true },
    ...(!compact ? [{ label: "Provider Cost", numeric: true }, { label: "Profit", numeric: true }, { label: "Latency", numeric: true }] : []), { label: "Status" }, { label: "Time (UTC)" }];
  return <AdminDataTable label={compact ? "Recent requests" : "Request history"} columns={columns} minWidth={compact ? 780 : 1300}>
    {requests.length === 0 ? <AdminEmpty columns={columns.length} onReset={onReset} /> : requests.map((request) => <TableRow key={request.id}>
      <TableCell><p className="font-medium">{request.user.name}</p>{!compact && <p className="mt-1 text-[10px] text-muted-foreground">{request.user.email}</p>}</TableCell>
      <TableCell><span className="font-mono text-xs">{request.model}</span>{!compact && <span className="mt-1 block font-mono text-[10px] text-muted-foreground">{request.requestId}</span>}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(request.inputTokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(request.outputTokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCny(request.userCost)}</TableCell>
      {!compact && <><TableCell className="text-right text-muted-foreground tabular-nums">{formatCny(request.providerCost)}</TableCell><TableCell className="text-right tabular-nums">{formatCny(request.profit)}</TableCell><TableCell className="text-right text-muted-foreground tabular-nums">{formatCount(request.latencyMs)}ms</TableCell></>}
      <TableCell><AdminStatus status={request.status} /></TableCell><TableCell><AdminTimestamp value={request.createdAt} /></TableCell>
    </TableRow>)}
  </AdminDataTable>;
}
