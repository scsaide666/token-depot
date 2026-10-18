"use client";

import { useRef, useState, type MouseEvent } from "react";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { modelProviders, type ModelProviderFilter, type PublicModel } from "@/lib/model-types";
import { formatCny, formatCount } from "@/lib/analytics-format";
import { ModelCatalogError } from "@/components/models/model-catalog-error";
import { ConsolePageHeader, ConsoleSelect } from "../console-primitives";
import { capabilityFilters, priceFilters, filterConsoleModels, type CapabilityFilter, type PriceFilter } from "./catalog-filters";
import { ModelCard } from "./model-card";
import { ModelCopyButton } from "./model-copy-button";
import { ConsoleModelDetail } from "./model-detail";
import { ProviderMark } from "@/components/brand-primitives";
import { ResponsiveFilters } from "@/components/ui/responsive-filters";

export function ModelsPage({ catalog, loadError }: { catalog: PublicModel[]; loadError: boolean }) {
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<ModelProviderFilter>("All");
  const [price, setPrice] = useState<PriceFilter>("all"), [capability, setCapability] = useState<CapabilityFilter>("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<PublicModel | null>(null), [detailOpen, setDetailOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null), triggerRef = useRef<HTMLButtonElement | null>(null);
  const models = filterConsoleModels(catalog, search, provider, price, capability);
  const hasFilters = !!search || provider !== "All" || price !== "all" || capability !== "all";
  function resetFilters() { setSearch(""); setProvider("All"); setPrice("all"); setCapability("all"); searchRef.current?.focus(); }
  function viewDetails(model: PublicModel, event: MouseEvent<HTMLButtonElement>) { triggerRef.current = event.currentTarget; setSelected(model); setDetailOpen(true); }
  return <div className="console-page console-models-page">
    <ConsolePageHeader title="Models" description="Explore available AI models and compare pricing." />
    <div className="console-filterbar">
      <label className="console-search"><span>Search models</span><span className="console-search-input"><Search size={14} aria-hidden="true" /><Input ref={searchRef} aria-label="Search models" placeholder="Search name or Model ID…" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" spellCheck={false} />{search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); searchRef.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}</span></label>
      <ResponsiveFilters activeCount={Number(provider !== "All") + Number(price !== "all") + Number(capability !== "all")}>
      <ConsoleSelect label="Provider" value={provider} options={modelProviders.map(value => ({ value, label: value }))} onChange={setProvider} />
      <ConsoleSelect label="Input price" value={price} options={priceFilters} onChange={setPrice} />
      <ConsoleSelect label="Capability" value={capability} options={capabilityFilters} onChange={setCapability} />
      </ResponsiveFilters>
    </div>
    <div className="console-results-toolbar"><p role="status" aria-atomic="true">{loadError ? "Model catalog unavailable" : `${models.length} ${models.length === 1 ? "model" : "models"}`}</p><div>{hasFilters && <button type="button" className="console-text-link" onClick={resetFilters}>Reset filters</button>}<div className="console-view-switch" role="group" aria-label="Model view"><button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={15} aria-hidden="true" /></button><button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={14} aria-hidden="true" /></button></div></div></div>
    {loadError ? <ModelCatalogError /> : !models.length ? <section className="console-empty" aria-label="Model catalog"><h2>{catalog.length ? "No models found" : "No models available"}</h2><p>{catalog.length ? "Try another search, provider, price or capability." : "Enabled models will appear here when they become available."}</p>{hasFilters && <Button variant="outline" onClick={resetFilters}>Reset filters</Button>}</section> : view === "grid" ? <section className="console-model-grid" aria-label="Model catalog">{models.map(model => <ModelCard key={model.slug} model={model} onViewDetails={viewDetails} />)}</section> : <section className="console-panel" aria-label="Model catalog">
      <Table className="min-w-[900px]" containerProps={{ role: "region", "aria-label": "Models, scroll horizontally for more columns", tabIndex: 0 }}><caption className="sr-only">Available models and sales prices in CNY per one million tokens.</caption><TableHeader><TableRow><TableHead>Model</TableHead><TableHead>Provider</TableHead><TableHead className="text-right">Context</TableHead><TableHead className="text-right">Input / 1M</TableHead><TableHead className="text-right">Output / 1M</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{models.map(model => <TableRow key={model.slug}><TableCell className="console-model-name-cell"><button type="button" aria-haspopup="dialog" onClick={event => viewDetails(model, event)}>{model.name}</button><code>{model.slug}</code></TableCell><TableCell><span className="console-provider"><ProviderMark provider={model.provider} />{model.provider}</span><Badge variant="secondary" className="mt-2">Available</Badge></TableCell><TableCell className="text-right tabular-nums">{formatCount(model.contextWindow)}</TableCell><TableCell className="text-right tabular-nums">{formatCny(model.inputPricePerMillion)}</TableCell><TableCell className="text-right tabular-nums">{formatCny(model.outputPricePerMillion)}</TableCell><TableCell className="text-right"><div className="console-model-row-actions"><Button variant="outline" size="sm" aria-haspopup="dialog" aria-label={`View details for ${model.name}`} onClick={event => viewDetails(model, event)}>Details</Button><ModelCopyButton id={model.slug} name={model.name} showId={false} /></div></TableCell></TableRow>)}</TableBody></Table>
    </section>}
    <p className="console-helper">Sales prices in CNY per 1M tokens. Long context: 128,000+ tokens. Chat capabilities reflect the available API endpoint.</p>
    <ConsoleModelDetail model={selected} open={detailOpen} onOpenChange={setDetailOpen} trigger={triggerRef} fallback={searchRef} />
  </div>;
}
