"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Feedback } from "@/components/ui/feedback";

export function ConsolePageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="console-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="console-page-actions">{actions}</div>}</header>;
}

export function ConsoleMetrics({ items, label }: { items: { label: string; value: string; detail?: string }[]; label: string }) {
  return <dl className="console-metrics" aria-label={label}>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}{item.detail && <span>{item.detail}</span>}</dd></div>)}</dl>;
}

export function ConsoleMetricsSkeleton({ count = 3 }: { count?: number }) {
  return <div role="status" aria-label="Loading metrics" className="console-metrics console-metrics-skeleton"><span className="sr-only">Loading metrics…</span>{Array.from({ length: count }, (_, index) => <div key={index} aria-hidden="true"><span /><strong /></div>)}</div>;
}

export function ConsoleTableSkeleton({ label, rows = 5 }: { label: string; rows?: number }) {
  return <div className="console-table-skeleton" role="status" aria-label={label}><span className="sr-only">{label}…</span><div aria-hidden="true"><div className="console-skeleton-heading" />{Array.from({ length: rows }, (_, index) => <div className="console-skeleton-row" key={index}><span /><span /><span /></div>)}</div></div>;
}

export function ConsoleFeedback({ message, error = false }: { message: string; error?: boolean }) {
  return <Feedback message={message} error={error} className="console-feedback" />;
}

export function ConsoleSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <label className="console-filter"><span>{label}</span><span className="console-select-wrap"><select aria-label={label} data-filter-active={value !== options[0]?.value || undefined} value={value} onChange={event => { const option = options.find(item => item.value === event.target.value); if (option) onChange(option.value); }}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></span></label>;
}
