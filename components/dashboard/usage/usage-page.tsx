"use client";
import { useState } from "react";
import type { AnalyticsMetric, UsageData } from "@/lib/analytics-types";
import { formatCount, formatMetric, formatCny, metricLabels, metricOptions, rangeLabel, rangeOptions } from "@/lib/analytics-format";
import { useAnalytics } from "../analytics/use-analytics";
import { DataError } from "../analytics/data-states";
import { ConsoleMetrics, ConsoleMetricsSkeleton, ConsolePageHeader } from "../console-primitives";
import { OverviewChartSkeleton } from "../overview-skeleton";
import { RequestHistory, UsageFilters } from "./request-history";
import { SegmentedControl } from "./segmented-control";
import { UsageLineChart } from "./usage-line-chart";

export function UsagePage({ initialData }: { initialData: UsageData }) {
  const { data, query, load, loading, error, retry } = useAnalytics(initialData, initialData.query, "/api/dashboard/usage");
  const [metric, setMetric] = useState<AnalyticsMetric>("tokens");
  const metrics = [{ label: "Total Requests", value: formatCount(data.stats.requests) }, { label: "Total Tokens", value: formatCount(data.stats.tokens) }, { label: "Total Cost", value: formatCny(data.stats.spend) }];
  return <div className="console-page console-usage-page">
    <ConsolePageHeader title="Usage" description="Track requests, token usage, latency and cost." actions={<div className="console-range-control"><SegmentedControl label="Time range" value={query.range} options={rangeOptions} onChange={range => void load({ ...query, range, page: 1 })} /><button type="button" disabled title="90-day view is not available yet." aria-label="90 days, not available yet">90D</button></div>} />
    <UsageFilters data={data} query={query} onChange={next => void load(next)} />
    <div className="console-page-content" aria-busy={loading}>
      {error && <DataError message={error} onRetry={retry} />}
      {loading ? <><ConsoleMetricsSkeleton /><div aria-hidden="true" className="console-secondary-metrics console-secondary-skeleton"><span /><span /><span /></div></> : !error && <><ConsoleMetrics items={metrics} label={`${query.range} usage metrics`} /><dl className="console-secondary-metrics"><div><dt>Average Latency</dt><dd>{data.stats.averageLatencyMs === null ? "—" : `${formatCount(data.stats.averageLatencyMs)}ms`}</dd></div><div><dt>Error Rate</dt><dd>{data.stats.errorRate}%</dd></div><div><dt>Period</dt><dd>{rangeLabel(data.query.range)}</dd></div></dl></>}
      <section className="console-panel console-usage-chart" aria-labelledby="usage-chart-title"><div className="console-panel-heading console-chart-heading"><div><h2 id="usage-chart-title">{metricLabels[metric]}</h2><p>{rangeLabel(query.range)} · UTC · All active filters</p></div><SegmentedControl label="Chart metric" value={metric} options={metricOptions} onChange={setMetric} /></div>
        {loading ? <OverviewChartSkeleton /> : <div className="console-chart-body">{error ? <div className="console-chart-empty"><h3>Usage chart unavailable.</h3><p>Retry loading your usage data.</p></div> : data.stats.requests === "0" ? <div className="console-chart-empty"><h3>No requests in this time range.</h3><p>Change the filters or make your first API request.</p></div> : <UsageLineChart key={`${query.range}-${metric}`} points={data.points} metric={metric} />}</div>}
        <p className="console-chart-summary" aria-live="polite">{loading ? "Updating usage…" : error ? "Usage data unavailable." : `${formatMetric(data.stats[metric], metric)} total ${metric === "spend" ? "cost" : metric}`}</p>
      </section>
      <p className="console-helper">Latency and error rate include completed requests. Cost includes finalized user charges; unavailable usage stays blank. 90-day view is not available yet.</p>
      {!error && <RequestHistory data={data} loading={loading} onPageChange={page => void load({ ...query, page })} />}
    </div>
  </div>;
}
