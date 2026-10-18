import { Badge } from "@/components/ui/badge";
import type { ProviderName } from "@/lib/model-types";
import { ProviderMark } from "@/components/brand-primitives";

export function ProviderLabel({ provider }: { provider: ProviderName }) {
  return <div className="flex items-center gap-2.5">
    <ProviderMark provider={provider} />
    <span className="text-xs text-muted-foreground">{provider}</span>
  </div>;
}

export function AvailabilityBadge({ status }: { status: "Available" }) {
  return <Badge variant="secondary" data-api-status="available" className="text-[11px] font-normal"><span className="sr-only">Availability: </span>{status}</Badge>;
}
