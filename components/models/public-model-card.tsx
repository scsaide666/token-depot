import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { ModelCopyButton } from "@/components/dashboard/models/model-copy-button";
import { modelContext, modelPrice, type PublicModel } from "@/lib/model-types";
import { AvailabilityBadge, ProviderLabel } from "./model-presentation";

export function PublicModelCard({ model, onViewDetails }: { model: PublicModel; onViewDetails: (model: PublicModel, event: MouseEvent<HTMLButtonElement>) => void }) {
  return <article aria-label={`${model.provider} ${model.name}`} className="public-model-card flex min-w-0 flex-col rounded-lg border border-border bg-card p-5 shadow-none xl:p-6">
    <div className="flex items-center justify-between gap-3"><ProviderLabel provider={model.provider} /><AvailabilityBadge status="Available" /></div>
    <h2 className="mt-5 text-xl leading-snug font-semibold tracking-[-0.035em] [overflow-wrap:anywhere]">{model.name}</h2>
    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{model.description}</p>
    <dl className="mt-6">
      <div><dt className="text-xs text-muted-foreground">Context Window</dt><dd className="mt-2 text-sm font-medium tabular-nums">{modelContext(model.contextWindow)}</dd></div>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div><dt className="text-xs text-muted-foreground">Input Price</dt><dd className="mt-2 break-all text-sm font-medium tracking-[-0.02em] tabular-nums">{modelPrice(model.inputPricePerMillion)}<span className="mt-1 block text-[11px] font-normal tracking-normal text-muted-foreground">/ 1M tokens</span></dd></div>
        <div><dt className="text-xs text-muted-foreground">Output Price</dt><dd className="mt-2 break-all text-sm font-medium tracking-[-0.02em] tabular-nums">{modelPrice(model.outputPricePerMillion)}<span className="mt-1 block text-[11px] font-normal tracking-normal text-muted-foreground">/ 1M tokens</span></dd></div>
      </div>
    </dl>
    <div className="mt-auto pt-6">
      <p className="mb-3 font-mono text-[11px] leading-relaxed text-muted-foreground break-all select-all"><span className="sr-only">Model ID: </span>{model.slug}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" aria-label={`View Details for ${model.name}`} aria-haspopup="dialog" onClick={(event) => onViewDetails(model, event)} className="min-w-[104px] flex-1 border-input px-3 text-xs">View Details</Button>
        <ModelCopyButton id={model.slug} name={model.name} showId={false} className="min-w-[132px] flex-1 px-3" />
      </div>
    </div>
  </article>;
}
