import { dailyUsage } from "@/lib/home-demo-data";

const points = dailyUsage.map(({ requests }, index) => {
  const x = 16 + index * (668 / (dailyUsage.length - 1));
  const y = 152 - (requests / 3000) * 144;
  return `${x.toFixed(2)},${y.toFixed(2)}`;
});
const line = `M${points.join(" L")}`;
const area = `${line} L684,152 L16,152 Z`;

export function UsageChart() {
  return (
    <section aria-labelledby="usage-chart-heading" className="mt-8 border-t border-border/60 pt-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 id="usage-chart-heading" className="text-sm font-medium">Usage Chart</h3>
        <span className="text-xs text-muted-foreground">Requests · 7 days</span>
      </div>
      <div className="mt-6 flex gap-3">
        <div aria-hidden="true" className="flex h-40 w-5 shrink-0 flex-col justify-between py-1 text-[10px] leading-none text-muted-foreground sm:h-44 sm:text-[11px]">
          <span>3k</span><span>2k</span><span>1k</span><span>0</span>
        </div>
        <svg role="img" aria-labelledby="usage-chart-title usage-chart-description" viewBox="0 0 700 160" preserveAspectRatio="none" className="h-40 min-w-0 flex-1 overflow-visible text-foreground sm:h-44">
          <title id="usage-chart-title">Daily API requests</title>
          <desc id="usage-chart-description">{dailyUsage.map(({ date, requests }) => `${date}: ${requests} requests`).join(". ")}. Total: 12,842 requests.</desc>
          {[8, 56, 104, 152].map((y) => <line key={y} x1="0" x2="700" y1={y} y2={y} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          <path d={area} fill="currentColor" opacity="0.035" />
          <path d={line} fill="none" stroke="currentColor" strokeOpacity="0.72" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div aria-hidden="true" className="mt-3 flex justify-between gap-1 pl-8 text-[10px] text-muted-foreground sm:text-[11px]">
        {dailyUsage.map(({ date }) => <span key={date}>{date}</span>)}
      </div>
    </section>
  );
}
