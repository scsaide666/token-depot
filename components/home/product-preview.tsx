"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, BarChart3, Box, ChevronRight, KeyRound, LockKeyhole, PanelLeft, ShieldCheck, ScanLine } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { modelContext, modelPrice, type PublicModel } from "@/lib/model-types";

const views = [
  { name: "Models", icon: Box, href: "/dashboard/models" },
  { name: "API keys", icon: KeyRound, href: "/dashboard/api-keys" },
  { name: "Usage", icon: BarChart3, href: "/dashboard/usage" },
] as const;

export function ProductPreview({ catalog, loadError }: { catalog: PublicModel[]; loadError: boolean }) {
  const [view, setView] = useState<typeof views[number]["name"]>("Models");
  const selected = views.find(item => item.name === view)!;
  return (
    <section className="v-section v-frame" aria-labelledby="product-preview-heading">
      <div className="v-section-heading">
        <div><p className="v-kicker">The Token Depot console</p><h2 id="product-preview-heading">Clarity at every step.</h2></div>
        <p>Your models, keys, and usage.<br className="hidden sm:block" /> One focused workspace.</p>
      </div>
      <div className="v-workspace-bento">
      <div className="v-console">
        <div className="v-console-bar">
          <span className="v-console-brand"><BrandMark size={20} className="rounded-[4px]" /> Token Depot <ChevronRight size={12} aria-hidden="true" /><span>Console preview</span></span>
          <Link href="/dashboard" className="v-text-link">Open console <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
        <div className="v-console-layout">
          <aside className="v-console-nav" aria-label="Product preview sections">
            <span className="v-workspace-label"><PanelLeft size={14} aria-hidden="true" /> Workspace</span>
            {views.map(({ name, icon: Icon }) => <button type="button" key={name} aria-pressed={view === name} onClick={() => setView(name)}><Icon size={15} aria-hidden="true" /> {name}</button>)}
          </aside>
          <div className="v-console-content">
            <div className="v-console-heading"><div><h3>{view}</h3><p>{view === "Models" ? "The current model catalog. Ready for your next request." : view === "API keys" ? "Create and manage your API credentials." : "Monitor requests, tokens, and actual spending."}</p></div><span className="v-preview-label">Preview</span></div>
            {view === "Models" ? (
              <>
                <div className="v-catalog-summary"><span>Available models</span><strong>{loadError ? "—" : catalog.length}</strong><span>Current platform pricing · CNY / 1M tokens</span></div>
                {loadError || !catalog.length ? <p className="v-empty" role={loadError ? "status" : undefined}>{loadError ? "The model catalog is temporarily unavailable." : "No models are available yet."}</p> :
                  <div className="v-table-scroll" tabIndex={0} aria-label="Console model table. Scroll horizontally on smaller screens.">
                    <table className="v-table v-console-table"><caption className="sr-only">Available models and current sales prices</caption><thead><tr><th>Model</th><th>Context</th><th className="v-number">Input</th><th className="v-number">Output</th></tr></thead><tbody>
                      {catalog.slice(0, 4).map(model => <tr key={model.slug}><td><strong>{model.name}</strong><span>{model.provider} · <code>{model.slug}</code></span></td><td className="v-mono">{modelContext(model.contextWindow)}</td><td className="v-number v-mono">{modelPrice(model.inputPricePerMillion)}</td><td className="v-number v-mono">{modelPrice(model.outputPricePerMillion)}</td></tr>)}
                    </tbody></table>
                  </div>}
                <Link href="/dashboard/models" className="v-console-bottom-link">Explore models in your workspace <ArrowRightIcon /></Link>
              </>
            ) : (
              <div className="v-private-preview">
                <LockKeyhole size={22} strokeWidth={1.5} aria-hidden="true" />
                <h4>Your workspace. Your data.</h4>
                <p>Sign in to see your {view === "API keys" ? "API keys" : "request history and usage"}. Account activity is never displayed publicly.</p>
                <Button size="sm" asChild><Link href={selected.href}>Open {view === "API keys" ? "API keys" : "usage"} <ArrowUpRight size={14} aria-hidden="true" /></Link></Button>
              </div>
            )}
          </div>
        </div>
        <p className="v-console-caption">Model data is live. Sign in to access account data.</p>
      </div>
      <article className="v-bento-panel v-bento-keys" aria-labelledby="bento-keys-heading">
        <span className="v-bento-icon"><ShieldCheck size={20} strokeWidth={1.6} aria-hidden="true" /></span>
        <div><h3 id="bento-keys-heading">Your keys. Your control.</h3><p>Create a key, save it once, and revoke it whenever you need.</p></div>
        <div className="v-key-illustration" aria-label="Masked API key illustration"><KeyRound size={14} aria-hidden="true" /><code>sk-aihub-••••••••</code><LockKeyhole size={13} aria-hidden="true" /></div>
        <Link href="/dashboard/api-keys" className="v-text-link">Manage API keys <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </article>
      <article className="v-bento-panel v-bento-usage" aria-labelledby="bento-usage-heading">
        <span className="v-bento-icon"><ScanLine size={20} strokeWidth={1.6} aria-hidden="true" /></span>
        <div><h3 id="bento-usage-heading">Every request, accounted for.</h3><p>Inspect recorded tokens and settled costs in your private workspace.</p></div>
        <dl className="v-token-illustration"><div><dt>Input tokens</dt><dd>Your prompt</dd></div><div><dt>Output tokens</dt><dd>Model response</dd></div></dl>
        <Link href="/dashboard/usage" className="v-text-link">Explore usage <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </article>
      </div>
    </section>
  );
}

function ArrowRightIcon() { return <ChevronRight size={14} aria-hidden="true" />; }

