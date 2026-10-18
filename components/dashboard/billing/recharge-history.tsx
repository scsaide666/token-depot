import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BillingData } from "@/lib/analytics-types";
import { requestDate, requestTime } from "@/lib/analytics-format";
import { formatPaymentMoney, paymentMethodNames } from "@/lib/payment-types";
import { DataEmpty } from "../analytics/data-states";
import { DataPagination } from "../analytics/pagination";
import { PaymentStatusBadge } from "./payment-status-badge";
import { ConsoleTableSkeleton } from "../console-primitives";
export function RechargeHistory({ data, onPageChange, loading = false }: { data: BillingData; onPageChange: (page: number) => void; loading?: boolean }) {
  return <section id="recharges" aria-labelledby="recharge-history-title" className="console-panel scroll-mt-24">
    <div className="console-panel-heading"><h2 id="recharge-history-title">Recharge History</h2><p>Your Alipay and WeChat Pay orders. Amounts in CNY.</p></div>
    {loading ? <ConsoleTableSkeleton label="Loading recharge history" rows={data.recharges.length || 3} /> : data.recharges.length === 0 ? <DataEmpty title="No recharges yet" description="Payment orders will appear here when you add balance." /> : <Table className="min-w-[700px] text-[13px]" containerProps={{ role: "region", "aria-label": "Recharge history table, scroll horizontally for more columns", tabIndex: 0 }}>
      <caption className="sr-only">Your recharge orders. Dates are UTC and amounts are CNY.</caption>
      <TableHeader><TableRow className="border-t border-border/60 bg-background/40 hover:bg-background/40"><TableHead className="pl-5 sm:pl-6">Time (UTC)</TableHead><TableHead>Order ID</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="pr-5 sm:pr-6">Status</TableHead></TableRow></TableHeader>
      <TableBody>{data.recharges.map((order) => <TableRow key={order.id} className="border-border/60"><TableCell className="py-5 pl-5 text-muted-foreground tabular-nums sm:pl-6"><p>{requestDate(order.createdAt)}</p><p className="mt-1 text-[11px]">{requestTime(order.createdAt)}</p></TableCell><TableCell><Link prefetch={false} href={`/dashboard/billing/payments/${order.id}`} className="font-mono text-xs transition-colors duration-200 hover:text-link focus-visible:outline-2 focus-visible:outline-ring" aria-label={`View payment ${order.orderNo}`}>{order.orderNo}</Link></TableCell><TableCell>{paymentMethodNames[order.method]}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatPaymentMoney(order.amount, order.currency)}</TableCell><TableCell className="pr-5 sm:pr-6"><PaymentStatusBadge status={order.status} /></TableCell></TableRow>)}</TableBody>
    </Table>}
    <DataPagination pagination={data.rechargePagination} label="Recharge history" disabled={loading} onChange={onPageChange} />
  </section>;
}
