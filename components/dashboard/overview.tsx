"use client";

import Link from "next/link";
import { BookOpen, KeyRound, RefreshCw } from "lucide-react";
import type { OverviewData } from "@/lib/analytics-types";
import { metricOptions, rangeOptions, requestTime } from "@/lib/analytics-format";
import { useState } from "react";
import type { AnalyticsMetric } from "@/lib/analytics-types";
import { useAccount } from "@/components/auth/account-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAnalytics } from "./analytics/use-analytics";
import { DataError } from "./analytics/data-states";
import { SegmentedControl } from "./usage/segmented-control";
import { DashboardUsageChart } from "./usage-chart";
import { DashboardRecentRequests } from "./recent-requests";
import { OverviewMetrics } from "./overview-metrics";
import { DashboardQuickStart, type QuickStartModel } from "./quick-start";
import { OverviewMetricsSkeleton, OverviewChartSkeleton, OverviewRequestsSkeleton } from "./overview-skeleton";

export function DashboardOverview({ initialData, models, modelLoadError, apiBaseUrl }: {
  initialData: OverviewData; models: QuickStartModel[]; modelLoadError: boolean; apiBaseUrl: string;
}) {
  const user = useAccount();
  const { data, query, load, loading, error, retry } = useAnalytics(initialData, { range: initialData.range }, "/api/dashboard/overview");
  const [metric, setMetric] = useState<AnalyticsMetric>("requests");
  return (
    <div className="dashboard-overview">
      <header className="overview-welcome"><div><h1>Overview</h1><p>Welcome back, {user.name}. Here’s your API activity.</p></div><div className="overview-quick-actions"><Button asChild variant="outline" size="sm"><Link href="/docs"><BookOpen size={14} aria-hidden="true" />Documentation</Link></Button><Button asChild size="sm"><Link href="/dashboard/api-keys"><KeyRound size={14} aria-hidden="true" />API Keys</Link></Button><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Refresh overview" disabled={loading} onClick={() => void load(query)}><RefreshCw size={14} aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>Refresh data</TooltipContent></Tooltip></div></header>
      <div aria-busy={loading} className="overview-data">
        {error && <DataError message={error} onRetry={retry} />}
        {loading ? <OverviewMetricsSkeleton /> : !error && <OverviewMetrics data={data} />}
          <section className="overview-analytics" aria-labelledby="usage-analytics-heading">
            <div className="overview-section-header"><div><h2 id="usage-analytics-heading">Usage Analytics</h2><p>Requests, tokens, and spending over time.</p></div><div className="overview-range-control"><SegmentedControl label="Overview chart time range" value={query.range} options={rangeOptions} onChange={range => void load({ range })} /><span className="overview-unavailable-range" title="90-day view is not available yet."><button type="button" disabled aria-label="90 days, not available yet">90D</button></span></div></div>
            <div className="overview-chart-toolbar"><SegmentedControl label="Overview chart metric" value={metric} options={metricOptions} onChange={setMetric} /><span aria-live="polite">{loading ? "Updating…" : error ? "Data unavailable" : `Updated ${requestTime(data.end)} UTC`}</span></div>
            {loading ? <OverviewChartSkeleton /> : !error && <DashboardUsageChart data={data} metric={metric} />}
            <p className="overview-chart-note">Times are UTC. 90-day view is not available yet.</p>
          </section>
          {loading ? <OverviewRequestsSkeleton /> : !error && <DashboardRecentRequests records={data.recentRequests} />}
      </div>
      <DashboardQuickStart models={models} loadError={modelLoadError} apiBaseUrl={apiBaseUrl} />
    </div>
  );
}

