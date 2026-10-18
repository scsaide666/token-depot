import type { OverviewData } from "@/lib/analytics-types";
import { formatCount, formatCny } from "@/lib/analytics-format";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function OverviewMetrics({ data }: { data: OverviewData }) {
  const metrics = [
    { label: "Available Balance", value: formatCny(data.availableBalance), detail: "After active reservations" },
    { label: "Requests This Month", value: formatCount(data.month.requests), detail: "All API requests" },
    { label: "Tokens This Month", value: formatCount(data.month.tokens), detail: "Recorded token usage" },
    { label: "Spend This Month", value: formatCny(data.monthSpend), detail: "Settled usage charges" },
  ];
  return <div><dl aria-label="Account usage metrics" className="overview-metrics">{metrics.map(({ label, value, detail }, index) => <div key={label}><dt>{index === 0 ? <Link href="/dashboard/billing">{label}<ArrowUpRight size={12} aria-hidden="true" /></Link> : label}</dt><dd>{value}<span>{detail}</span></dd></div>)}</dl><p className="overview-metrics-note">Monthly metrics use UTC. Unconfirmed usage is not billed.</p></div>;
}
