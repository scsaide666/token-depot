import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { modelContext, modelPrice, type PublicModel } from "@/lib/model-types";

export function PricingSection({ catalog, loadError }: { catalog: PublicModel[]; loadError: boolean }) {
  return (
    <section id="pricing" className="v-section v-frame v-pricing-section" aria-labelledby="pricing-heading">
      <div className="v-section-heading">
        <div><p className="v-kicker">Usage-based pricing</p><h2 id="pricing-heading">Every token.<br />Clearly accounted for.</h2></div>
        <div className="v-heading-aside"><p>Pay for what you use.<br />No subscriptions required.</p><Button variant="outline" size="sm" asChild><Link href="/pricing">View all pricing <ArrowUpRight size={14} aria-hidden="true" /></Link></Button></div>
      </div>
      {loadError || !catalog.length ? <p className="v-empty" role={loadError ? "status" : undefined}>{loadError ? "Pricing is temporarily unavailable." : "Pricing will appear when models are available."}</p> :
        <div className="v-price-table v-table-scroll" tabIndex={0} aria-label="Model pricing table. Scroll horizontally on smaller screens.">
          <div className="v-price-table-caption"><span>Model pricing</span><span>CNY / 1M tokens</span></div>
          <table className="v-table"><caption className="sr-only">Current platform sales prices in CNY per one million tokens</caption><thead><tr><th>Model</th><th>Provider</th><th className="v-number">Input / 1M tokens</th><th className="v-number">Output / 1M tokens</th><th className="v-number">Context</th></tr></thead><tbody>
            {catalog.slice(0, 6).map(model => <tr key={model.slug}><td><Link href="/models"><strong>{model.name}</strong><code>{model.slug}</code></Link></td><td>{model.provider}</td><td className="v-number v-mono">{modelPrice(model.inputPricePerMillion)}</td><td className="v-number v-mono">{modelPrice(model.outputPricePerMillion)}</td><td className="v-number v-mono">{modelContext(model.contextWindow)}</td></tr>)}
          </tbody></table>
        </div>}
      <div className="v-pricing-note"><span>All prices in CNY. Input and output tokens are billed separately.</span><Link href="/docs#billing" className="v-text-link">How billing works <ArrowUpRight size={13} aria-hidden="true" /></Link></div>
    </section>
  );
}

