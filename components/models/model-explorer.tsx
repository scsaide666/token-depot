"use client";

import { useRef, useState, type MouseEvent } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterModels, modelProviders, type ModelProviderFilter, type PublicModel } from "@/lib/model-types";
import { ModelCatalogError } from "./model-catalog-error";
import { PublicModelCard } from "./public-model-card";
import { ModelDetail } from "./model-detail";

export function ModelExplorer({ catalog, loadError }: { catalog: PublicModel[]; loadError: boolean }) {
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<ModelProviderFilter>("All");
  const [selectedModel, setSelectedModel] = useState<PublicModel | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const models = filterModels(catalog, search, provider);
  const hasFilters = search.length > 0 || provider !== "All";

  function resetFilters() { setSearch(""); setProvider("All"); searchRef.current?.focus(); }
  function viewDetails(model: PublicModel, event: MouseEvent<HTMLButtonElement>) { returnFocusRef.current = event.currentTarget; setSelectedModel(model); setDetailsOpen(true); }

  if (loadError) return <ModelCatalogError />;
  return <section aria-label="Explore model catalog" className="mx-auto max-w-[var(--content-public)]">
    <div className="flex flex-col gap-3 md:flex-row md:gap-4">
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" strokeWidth={1.6} className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input ref={searchRef} type="search" aria-label="Search models" placeholder="Search models" value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" spellCheck={false} className="pricing-search border-input pr-11 pl-10 sm:text-sm" />
        {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); searchRef.current?.focus(); }} className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><X aria-hidden="true" className="size-3.5" strokeWidth={1.6} /></button>}
      </div>
      <label className="relative flex w-full shrink-0 items-center md:w-[210px]">
        <span className="pointer-events-none absolute left-3.5 text-xs text-muted-foreground">Provider</span>
        <select aria-label="Provider" value={provider} onChange={(event) => { const option = modelProviders.find((item) => item === event.target.value); if (option) setProvider(option); }} className="model-explorer-select pl-[78px]">
          {modelProviders.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 size-3.5 text-muted-foreground" strokeWidth={1.6} />
      </label>
    </div>
    <div className="mt-6 mb-4 flex min-h-5 items-center justify-between gap-4">
      <p role="status" aria-atomic="true" className="text-xs text-muted-foreground">{models.length} {models.length === 1 ? "model" : "models"}{provider !== "All" && ` from ${provider}`}</p>
      {hasFilters && <button type="button" onClick={resetFilters} className="auth-link shrink-0 text-xs">Reset filters</button>}
    </div>
    {models.length ? <div aria-label="Model results" className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{models.map((model) => <PublicModelCard key={model.slug} model={model} onViewDetails={viewDetails} />)}</div> : <div className="rounded-lg border border-border bg-card px-6 py-16 text-center"><h2 className="text-lg tracking-[-0.025em]">No models found</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">No matching models are currently available. Try a different search or provider.</p><Button variant="secondary" onClick={resetFilters} className="mt-6">Reset filters</Button></div>}
    <p className="mt-6 text-xs leading-relaxed text-muted-foreground">Prices in CNY per 1M tokens.</p>
    <ModelDetail model={selectedModel} open={detailsOpen} onOpenChange={setDetailsOpen} returnFocusRef={returnFocusRef} fallbackFocusRef={searchRef} />
  </section>;
}
