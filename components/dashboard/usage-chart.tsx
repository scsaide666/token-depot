import Link from "next/link";
import { ChartNoAxesCombined } from "lucide-react";
import type { AnalyticsMetric, OverviewData } from "@/lib/analytics-types";
import { rangeLabel } from "@/lib/analytics-format";
import { UsageLineChart } from "./usage/usage-line-chart";

export function DashboardUsageChart({ data, metric = "requests" }: { data: OverviewData; metric?: AnalyticsMetric }) {
  const empty = data.points.every(point => point.requests === "0");
  return <div className="overview-chart"><p className="overview-chart-range">{rangeLabel(data.range)}</p>{empty ? <div className="overview-chart-empty"><ChartNoAxesCombined size={22} strokeWidth={1.5} aria-hidden="true" /><h3>No API activity yet</h3><p>There are no requests in this time range.</p><Link href="/docs#quick-start" className="console-text-link">Send your first request</Link></div> : <UsageLineChart points={data.points} metric={metric} />}</div>;
}

