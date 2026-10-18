"use client";

import { useId, useState, useMemo, memo, type KeyboardEvent, type PointerEvent } from "react";
import type { AnalyticsMetric as UsageMetric } from "@/lib/analytics-types";
import { formatMetric, metricLabels as usageMetricLabels } from "@/lib/analytics-format";
type UsagePoint = { label: string; requests: string | number; tokens: string | number; spend: string | number };

function chartMaximum(values: number[]) {
  const largest = Math.max(...values, 0);
  if (!largest) return 1;
  const scale = 10 ** Math.floor(Math.log10(largest));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => step * scale >= largest) ?? 10;
  return step * scale;
}

const axisFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });
export const UsageLineChart = memo(function UsageLineChart({ points, metric }: { points: UsagePoint[]; metric: UsageMetric }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const instructionId = useId();
  // Number conversion is only for SVG geometry/axis labels. Totals and tooltips keep exact strings.
  const { maximum, coordinates, line } = useMemo(() => {
    const maximum = chartMaximum(points.map((point) => Number(point[metric])));
    const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? 350 : index * 700 / (points.length - 1),
    y: 240 - Number(point[metric]) / maximum * 240,
  }));
    const line = coordinates.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
    return { maximum, coordinates, line };
  }, [points, metric]);
  const visibleIndex = activeIndex === null ? null : Math.min(activeIndex, Math.max(0, points.length - 1));
  const active = visibleIndex === null ? null : points[visibleIndex];
  const position = visibleIndex === null ? null : coordinates[visibleIndex];
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const labelIndexes = points.length ? [...new Set([0, Math.round((points.length - 1) / 2), points.length - 1])] : [];

  function inspectPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.round(fraction * (points.length - 1)));
  }

  function inspectKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    setActiveIndex((current) => {
      if (event.key === "Escape") return null;
      if (event.key === "Home") return 0;
      if (event.key === "End") return points.length - 1;
      const next = (current ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1);
      return Math.max(0, Math.min(points.length - 1, next));
    });
  }

  return (
    <div data-slot="usage-line-chart" className="mt-9 min-w-0">
      <p id={instructionId} className="sr-only">Hover or tap to inspect a point. With the chart focused, use left and right arrow keys to move, Home or End to jump, and Escape to dismiss the tooltip.</p>
      <div className="flex gap-3 sm:gap-4">
        <div aria-hidden="true" className="relative h-[216px] w-10 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums sm:h-60 sm:text-[11px]">
          {ticks.map((tick) => <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - tick) * 100}%` }}>{metric === "spend" ? "¥" : ""}{axisFormatter.format(maximum * tick)}</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <div role="group" aria-roledescription="interactive line chart" aria-label={`${usageMetricLabels[metric]} by ${points.length === 24 ? "hour" : "day"}`} aria-describedby={instructionId} tabIndex={0}
            onPointerMove={inspectPointer} onPointerDown={inspectPointer} onPointerLeave={(event) => { if (document.activeElement !== event.currentTarget) setActiveIndex(null); }}
            onFocus={() => setActiveIndex((current) => current ?? points.length - 1)} onBlur={() => setActiveIndex(null)} onKeyDown={inspectKeyboard}
            className="relative h-[216px] touch-pan-y rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card sm:h-60">
            <svg aria-hidden="true" viewBox="0 0 700 240" preserveAspectRatio="none" className="h-full w-full overflow-visible">
              {ticks.map((tick) => <line key={tick} x1="0" x2="700" y1={(1 - tick) * 240} y2={(1 - tick) * 240} stroke="var(--border)" strokeOpacity="1" vectorEffect="non-scaling-stroke" />)}
              <path d={line} fill="none" stroke="var(--chart-line)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {points.length === 1 && <circle cx={coordinates[0].x} cy={coordinates[0].y} r="3" fill="var(--chart-line)" />}
              {position && <line x1={position.x} x2={position.x} y1="0" y2="240" stroke="var(--border)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
            </svg>
            {active && position && <>
              <span aria-hidden="true" className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-chart-line ring-1 ring-chart-line/30" style={{ left: `${position.x / 7}%`, top: `${position.y / 2.4}%` }} />
              <div aria-hidden="true" data-slot="usage-chart-tooltip" className="pointer-events-none absolute top-2 z-10 w-[140px] max-w-full rounded-sm border border-border bg-card px-3 py-2.5 shadow-sm" style={{ left: `clamp(min(70px, 50%), ${position.x / 7}%, max(50%, calc(100% - 70px)))`, transform: "translateX(-50%)" }}>
                <p className="text-[11px] text-muted-foreground">{active.label}</p>
                <p className="mt-1 text-[13px] font-medium break-all tabular-nums">{formatMetric(String(active[metric]), metric)}<span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{metric === "spend" ? "CNY" : metric}</span></p>
              </div>
            </>}
            <span role="status" className="sr-only">{active ? `${active.label}: ${formatMetric(String(active[metric]), metric)} ${metric === "spend" ? "CNY" : metric}` : ""}</span>
          </div>
          <div aria-hidden="true" className="relative mt-4 h-4 text-[10px] text-muted-foreground sm:text-[11px]">
            {labelIndexes.map((index, order) => <span key={index} className="absolute whitespace-nowrap" style={{ left: `${points.length === 1 ? 50 : index / (points.length - 1) * 100}%`, transform: points.length === 1 ? "translateX(-50%)" : order === 0 ? "none" : order === labelIndexes.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{points[index].label}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
});
