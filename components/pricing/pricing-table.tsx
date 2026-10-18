"use client";

import { useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterModels, modelProviders, type ModelProviderFilter, modelPrice, modelContext, type PublicModel } from "@/lib/model-types";
import { ModelCatalogError } from "@/components/models/model-catalog-error";

export function PricingTable({ catalog, loadError }: { catalog: PublicModel[]; loadError: boolean }) {
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<ModelProviderFilter>("All");
  const searchRef = useRef<HTMLInputElement>(null);
  const models = filterModels(catalog, search, provider);
  const hasFilters = search.length > 0 || provider !== "All";

  function resetFilters() {
    setSearch(""); setProvider("All"); searchRef.current?.focus();
  }

  if (loadError) return <ModelCatalogError />;
  return <section aria-labelledby="model-pricing-heading" className="mx-auto max-w-[var(--content-public)]">
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
      <div>
        <h2 id="model-pricing-heading" className="text-2xl leading-snug font-semibold tracking-[-0.035em]">Model pricing</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Prices in CNY per 1M tokens.</p>
      </div>
      <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
        <div className="relative w-full lg:w-[260px]">
          <Search aria-hidden="true" strokeWidth={1.6} className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} type="search" aria-label="Search Model" placeholder="Search Model" value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" spellCheck={false} className="pricing-search border-input pr-11 pl-10 sm:text-sm" />
          {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); searchRef.current?.focus(); }} className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><X aria-hidden="true" className="size-3.5" strokeWidth={1.6} /></button>}
        </div>
        <label className="relative flex w-full shrink-0 items-center sm:w-[210px]">
          <span className="pointer-events-none absolute left-3.5 text-xs text-muted-foreground">Provider</span>
          <select aria-label="Provider" value={provider} onChange={(event) => {
            const selected = modelProviders.find((option) => option === event.target.value);
            if (selected) setProvider(selected);
          }} className="h-11 w-full cursor-pointer appearance-none rounded-sm border border-input bg-card pr-9 pl-[78px] text-base outline-none transition-[border-color,box-shadow] duration-200 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 sm:text-sm">
            {modelProviders.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 size-3.5 text-muted-foreground" strokeWidth={1.6} />
        </label>
      </div>
    </div>
    <div className="mt-6 mb-3 flex min-h-5 items-center justify-between gap-4">
      <p role="status" aria-atomic="true" className="text-xs text-muted-foreground">{models.length} {models.length === 1 ? "model" : "models"}{provider !== "All" && ` from ${provider}`}</p>
      {hasFilters && <button type="button" onClick={resetFilters} className="auth-link text-xs">Reset filters</button>}
    </div>
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {models.length ? <Table className="min-w-[720px]" containerProps={{ tabIndex: 0, role: "region", "aria-label": "Model prices, scroll horizontally to compare all columns", className: "pricing-table-scroll outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" }}>
        <TableCaption className="sr-only">Model selling prices in CNY per one million tokens.</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="h-12 px-4 sm:px-6">Model</TableHead>
            <TableHead scope="col" className="px-5">Provider</TableHead>
            <TableHead scope="col" className="px-5 text-right"><span className="block">Input</span><span className="mt-0.5 block text-[11px]">/ 1M tokens</span></TableHead>
            <TableHead scope="col" className="px-5 text-right"><span className="block">Output</span><span className="mt-0.5 block text-[11px]">/ 1M tokens</span></TableHead>
            <TableHead scope="col" className="pr-4 pl-5 text-right sm:pr-6">Context</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((model) => <TableRow key={model.slug} className="hover:bg-secondary">
            <TableCell className="px-4 py-4 sm:px-6"><span className="block text-sm font-semibold tracking-[-0.015em] sm:text-[15px]">{model.name}</span><span className="mt-1.5 block font-mono text-[11px] text-muted-foreground">{model.slug}</span></TableCell>
            <TableCell className="px-5 text-[13px] text-muted-foreground">{model.provider}</TableCell>
            <TableCell className="px-5 text-right text-[15px] tabular-nums">{modelPrice(model.inputPricePerMillion)}</TableCell>
            <TableCell className="px-5 text-right text-[15px] tabular-nums">{modelPrice(model.outputPricePerMillion)}</TableCell>
            <TableCell className="pr-4 pl-5 text-right text-[13px] whitespace-nowrap text-muted-foreground tabular-nums sm:pr-6">{modelContext(model.contextWindow)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table> : <div className="px-6 py-16 text-center">
        <h3 className="text-lg tracking-[-0.025em]">No models found</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Try a different model name or provider.</p>
        <Button variant="secondary" onClick={resetFilters} className="mt-6">Reset filters</Button>
      </div>}
    </div>
    {models.length > 0 && <p className="mt-3 text-xs text-muted-foreground sm:hidden">Scroll to compare all prices.</p>}
  </section>;
}
