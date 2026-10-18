"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

// CSS controls the breakpoint so desktop fields are available before hydration.
// On mobile display:none removes collapsed fields from both Tab order and the AX tree.
export function ResponsiveFilters({ children, activeCount = 0 }: { children: ReactNode; activeCount?: number }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <div className="responsive-filters">
    <Button type="button" variant="outline" className="responsive-filters-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <SlidersHorizontal size={14} aria-hidden="true" />Filters{activeCount > 0 && <span className="responsive-filter-count">{activeCount}<span className="sr-only"> active</span></span>}<ChevronDown size={14} aria-hidden="true" />
    </Button>
    <div id={id} className="responsive-filter-fields" data-expanded={open}>{children}</div>
  </div>;
}
