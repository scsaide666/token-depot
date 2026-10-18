import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BillingData } from "@/lib/analytics-types";
import { formatCny, requestDate, requestTime } from "@/lib/analytics-format";
import { DataEmpty } from "../analytics/data-states";
import { DataPagination } from "../analytics/pagination";
import { ConsoleTableSkeleton } from "../console-primitives";
export function TransactionHistory({ data, onPageChange, loading = false }: { data: BillingData; onPageChange: (page: number) => void; loading?: boolean }) {
  return <section id="transactions" aria-labelledby="transaction-history-title" className="console-panel scroll-mt-24"><div className="console-panel-heading"><h2 id="transaction-history-title">Transaction History</h2><p>API usage, successful recharges and recorded balance adjustments.</p></div>
    {loading ? <ConsoleTableSkeleton label="Loading transaction history" rows={data.transactions.length || 3} /> : data.transactions.length === 0 ? <DataEmpty title="No transactions yet" description="API usage and successful recharges will appear here." /> : <Table className="min-w-[700px] text-[13px]" containerProps={{ role: "region", "aria-label": "Transaction history table, scroll horizontally for more columns", tabIndex: 0, className: "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" }}>
      <caption className="sr-only">Your wallet transactions. Dates are UTC and amounts are in CNY.</caption><TableHeader><TableRow className="border-t border-border/60 bg-background/40 hover:bg-background/40"><TableHead className="pl-5 sm:pl-6">Date (UTC)</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance After</TableHead><TableHead className="pr-5 sm:pr-6">Description</TableHead></TableRow></TableHeader>
      <TableBody>{data.transactions.map((transaction) => <TableRow key={transaction.id} className="border-border/60"><TableCell className="py-5 pl-5 text-muted-foreground tabular-nums sm:pl-6"><p>{requestDate(transaction.createdAt)}</p><p className="mt-1 text-[11px]">{requestTime(transaction.createdAt)}</p></TableCell><TableCell>{transaction.type === "RECHARGE" ? "Recharge" : transaction.type === "ADMIN_ADJUSTMENT" ? "Balance adjustment" : "API Usage"}</TableCell><TableCell className={`text-right font-medium tabular-nums ${transaction.type === "RECHARGE" ? "text-emerald-700 dark:text-emerald-400" : "text-foreground/85"}`}>{formatCny(transaction.amount, true)}</TableCell><TableCell className="text-right tabular-nums">{formatCny(transaction.balanceAfter)}</TableCell><TableCell className="max-w-[300px] pr-5 whitespace-normal text-muted-foreground break-words sm:pr-6">{transaction.description}</TableCell></TableRow>)}</TableBody>
    </Table>}
    <DataPagination pagination={data.pagination} label="Transaction history" disabled={loading} onChange={onPageChange} />
  </section>;
}
