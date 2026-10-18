export function OverviewMetricsSkeleton() {
  return <div role="status" aria-label="Loading account metrics"><span className="sr-only">Loading account metrics…</span><div className="overview-metrics overview-metrics-skeleton" aria-hidden="true">{[0, 1, 2, 3].map(index => <div key={index}><span /><strong /><small /></div>)}</div><div className="overview-metrics-note overview-metrics-skeleton-note" aria-hidden="true" /></div>;
}
export function OverviewChartSkeleton() {
  return <div role="status" aria-label="Loading usage analytics" className="overview-chart-skeleton"><span className="sr-only">Loading usage analytics…</span><div aria-hidden="true" /></div>;
}
export function OverviewRequestsSkeleton() {
  return <div role="status" aria-label="Loading recent requests" className="overview-requests-skeleton"><span className="sr-only">Loading recent requests…</span><div aria-hidden="true" /><div aria-hidden="true">{[0, 1, 2].map(index => <span key={index} />)}</div></div>;
}
