"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { searchDocumentation, type DocsSearchEntry } from "@/lib/docs-search";

export function DocsSearch() {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [entries, setEntries] = useState<DocsSearchEntry[]>([]);
  const destination = useRef<string | null>(null), input = useRef<HTMLInputElement>(null);
  const results = searchDocumentation(entries, query);
  function openSearch() {
    // Search the actual rendered reference, including current catalog and policy values.
    const next: DocsSearchEntry[] = [];
    document.querySelectorAll<HTMLElement>("[data-docs-section]").forEach(section => {
      const heading = section.querySelector<HTMLElement>("[data-docs-heading]");
      if (!heading) return;
      next.push({ id: heading.id, title: heading.textContent ?? "", section: heading.textContent ?? "", text: section.textContent ?? "" });
      section.querySelectorAll<HTMLElement>("[data-docs-topic]").forEach(topic => {
        const title = topic.querySelector<HTMLElement>("[data-docs-heading]");
        if (title) next.push({ id: title.id, title: title.textContent ?? "", section: heading.textContent ?? "", text: topic.textContent ?? "" });
      });
    });
    setEntries(next); setQuery(""); setOpen(true);
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.isComposing) { event.preventDefault(); document.getElementById("docs-search-trigger")?.click(); }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  return <>
    <Button id="docs-search-trigger" variant="outline" size="sm" onClick={openSearch} className="docs-search-trigger" aria-label="Search documentation"><Search size={15} aria-hidden="true" /><span className="hidden md:inline">Search docs</span><kbd className="hidden font-mono text-[10px] text-muted-foreground lg:inline">⌘ / Ctrl K</kbd></Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent lang="en" className="docs-search-dialog" onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }} onCloseAutoFocus={event => {
      event.preventDefault(); if (destination.current) { const target = document.getElementById(destination.current); destination.current = null; target?.focus({ preventScroll: true }); requestAnimationFrame(() => target?.scrollIntoView({ block: "start", behavior: "instant" })); } else document.getElementById("docs-search-trigger")?.focus();
    }}><DialogHeader><DialogTitle>Search documentation</DialogTitle><DialogDescription>Search the full API reference, examples and model catalog.</DialogDescription></DialogHeader>
      <Input ref={input} type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} aria-label="Search documentation text" placeholder="Search endpoints, parameters, errors…" autoComplete="off" />
      <p role="status" className="text-xs text-muted-foreground">{!query.trim() ? "Try “stream”, “API key” or an error code." : `${results.length}${results.length === 20 ? "+" : ""} results`}</p>
      <div className="docs-search-results">{query.trim() && !results.length && <p className="py-6 text-sm text-muted-foreground">No matching documentation. Try another keyword.</p>}{results.map(result => <a key={result.id} href={`#${result.id}`} className="docs-search-result" onClick={event => { event.preventDefault(); destination.current = result.id; history.pushState(history.state, "", `#${result.id}`); setOpen(false); }}><span className="text-[11px] text-muted-foreground">{result.section}</span><strong className="mt-1 block text-sm font-medium">{result.title}</strong><span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{result.excerpt}</span></a>)}</div>
    </DialogContent></Dialog>
  </>;
}
