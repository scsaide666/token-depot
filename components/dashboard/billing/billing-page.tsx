"use client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BillingData } from "@/lib/analytics-types";
import { formatCny } from "@/lib/analytics-format";
import { useAnalytics } from "../analytics/use-analytics";
import { DataError } from "../analytics/data-states";
import { ConsoleMetrics, ConsoleMetricsSkeleton, ConsolePageHeader } from "../console-primitives";
import { TransactionHistory } from "./transaction-history";
import { RechargeHistory } from "./recharge-history";
import { AddBalanceDialog } from "./add-balance-dialog";

export function BillingPage({ initialData }: { initialData: BillingData }) {
  const { data, query, load, loading, error, retry } = useAnalytics(initialData, { page: initialData.pagination.page, pageSize: initialData.pagination.pageSize, rechargePage: initialData.rechargePagination.page }, "/api/dashboard/billing");
  const spending = [{ label: "Reserved Balance", value: formatCny(data.reservedBalance) }, { label: "This Month Spend", value: formatCny(data.monthSpend) }, { label: "Lifetime Spend", value: formatCny(data.lifetimeSpend) }];
  return <div className="console-page console-billing-page">
    <ConsolePageHeader title="Billing" description="Manage your balance, spending and transaction history." actions={<Button variant="outline" size="sm" disabled={loading} onClick={() => void load(query)} aria-label="Refresh billing"><RefreshCw size={14} aria-hidden="true" />{loading ? "Refreshing…" : "Refresh"}</Button>} />
    <div className="console-page-content" aria-busy={loading}>
      {error && <DataError message={error} onRetry={retry} />}
      <section className="console-balance-panel" aria-labelledby="balance-title"><div><h2 id="balance-title">Available Balance <span>CNY</span></h2>{loading ? <div className="console-balance-skeleton" role="status" aria-label="Loading available balance" /> : <p className="console-balance-value">{error ? "—" : formatCny(data.availableBalance)}</p>}<p className="console-helper">Balance after active request reservations.</p></div><div className="console-recharge-action"><AddBalanceDialog options={data.paymentOptions} label="Recharge" /><p>Alipay &amp; WeChat Pay</p>{!data.paymentOptions.enabled && <p>Payment methods are currently unavailable.</p>}</div></section>
      <section className="console-spending" aria-labelledby="spending-overview-title"><div className="console-section-heading"><h2 id="spending-overview-title">Usage Spending</h2><p>Settled charges and active reservations.</p></div>{loading ? <ConsoleMetricsSkeleton /> : !error && <ConsoleMetrics items={spending} label="Wallet spending" />}<p className="console-helper">Monthly spend uses the UTC settlement date. Only finalized ledger charges count.</p></section>
      {!error && <><TransactionHistory data={data} loading={loading} onPageChange={page => void load({ ...query, page })} /><RechargeHistory data={data} loading={loading} onPageChange={rechargePage => void load({ ...query, rechargePage })} /></>}
    </div>
  </div>;
}
