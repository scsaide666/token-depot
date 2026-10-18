import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestRecord } from "@/lib/analytics-types";
import { formatCount, formatCny, requestDate, requestTime } from "@/lib/analytics-format";
import { DataEmpty } from "./data-states";
const statusLabels = { PENDING: "Pending", SUCCESS: "Success", FAILED: "Failed" };
export function RequestTable({ records, label }: { records: RequestRecord[]; label: string }) {
  if (!records.length) return <DataEmpty title="No requests yet" description="No API requests match this view. Make a request or choose another filter." />;
  return <Table containerProps={{ role: "region", "aria-label": `${label}, scroll horizontally for more columns`, tabIndex: 0, className: "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" }} className="min-w-[520px] text-[13px] sm:min-w-[760px]">
    <caption className="sr-only">Your API request history. Times are UTC and costs are in CNY. A dash means usage or final billing is unavailable.</caption>
    <TableHeader><TableRow className="border-t border-border/60 bg-background/40 hover:bg-background/40">
      <TableHead className="hidden pl-6 sm:table-cell">Time (UTC)</TableHead><TableHead className="pl-5 sm:pl-2">Model</TableHead>
      <TableHead className="text-right sm:hidden">Tokens</TableHead><TableHead className="hidden text-right sm:table-cell">Input Tokens</TableHead><TableHead className="hidden text-right sm:table-cell">Output Tokens</TableHead>
      <TableHead className="text-right">Cost</TableHead><TableHead className="hidden text-right sm:table-cell">Latency</TableHead><TableHead className="pr-5 pl-6 sm:pr-6">Status</TableHead>
    </TableRow></TableHeader>
    <TableBody>{records.map((record) => <TableRow key={record.id} className="border-border/60">
      <TableCell className="hidden py-4 pl-6 tabular-nums sm:table-cell"><p>{requestTime(record.createdAt)}</p><p className="mt-1 text-[11px] text-muted-foreground">{requestDate(record.createdAt)}</p></TableCell>
      <TableCell className="py-4 pl-5 sm:pl-2"><p className="max-w-[240px] whitespace-normal font-medium break-all">{record.model}</p><p className="mt-1 max-w-[240px] whitespace-normal text-[11px] text-muted-foreground break-words">{record.apiKeyName}<span className="sm:hidden"> · {requestDate(record.createdAt)}, {requestTime(record.createdAt)} UTC</span></p></TableCell>
      <TableCell className="text-right tabular-nums sm:hidden">{formatCount(record.totalTokens)}<p className="mt-1 text-[10px] text-muted-foreground">{formatCount(record.inputTokens)} in / {formatCount(record.outputTokens)} out</p></TableCell>
      <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatCount(record.inputTokens)}</TableCell><TableCell className="hidden text-right tabular-nums sm:table-cell">{formatCount(record.outputTokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCny(record.cost)}</TableCell><TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{record.status === "PENDING" ? "—" : `${formatCount(record.latencyMs)}ms`}</TableCell>
      <TableCell className="pr-5 pl-6 sm:pr-6"><Badge variant="secondary" data-api-status={record.status} className={record.status === "FAILED" ? "bg-destructive/7 text-[11px] font-normal text-destructive" : "bg-secondary/70 text-[11px] font-normal text-muted-foreground"}>{statusLabels[record.status]}</Badge></TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}
