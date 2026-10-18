import { Button } from "@/components/ui/button";
import type { PageInfo } from "@/lib/analytics-types";
import { formatCount } from "@/lib/analytics-format";
export function DataPagination({ pagination, onChange, disabled = false, label }: { pagination: PageInfo; onChange: (page: number) => void; disabled?: boolean; label: string }) {
  const { page, pageSize, total, totalPages } = pagination;
  return <nav data-slot="data-pagination" aria-label={`${label} pagination`} className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
    <p role="status" className="text-xs text-muted-foreground">{total === 0 ? "0 records" : `Showing ${formatCount((page - 1) * pageSize + 1)}–${formatCount(Math.min(page * pageSize, total))} of ${formatCount(total)}`}</p>
    <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)} aria-label={`Previous ${label.toLowerCase()} page`}>Previous</Button><span className="px-1 text-xs tabular-nums text-muted-foreground">Page {page} of {formatCount(totalPages)}</span><Button size="sm" variant="outline" disabled={disabled || page >= totalPages} onClick={() => onChange(page + 1)} aria-label={`Next ${label.toLowerCase()} page`}>Next</Button></div>
  </nav>;
}
