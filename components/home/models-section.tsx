import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { ProviderMark } from "@/components/brand-primitives";
import { modelContext, modelPrice, type PublicModel } from "@/lib/model-types";

export function ModelsSection({ catalog, loadError }: { catalog: PublicModel[]; loadError: boolean }) {
  return (
    <section id="models" className="v-section v-frame v-model-section" aria-labelledby="models-heading">
      <div className="v-section-heading">
        <div><p className="v-kicker">The model layer</p><h2 id="models-heading">Choose your model.<br />Keep your workflow.</h2></div>
        <div className="v-heading-aside"><p>One consistent interface.<br />Current models. Clear specifications.</p><Link href="/models" className="v-text-link">Explore all models <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
      </div>
      {loadError || !catalog.length ? <p className="v-empty" role={loadError ? "status" : undefined}>{loadError ? "Models could not be loaded. Please try again shortly." : "No models are currently available."}</p> :
        <div className="v-model-list">
          {catalog.slice(0, 6).map(model => <Link key={model.slug} href="/models" aria-label={`Explore the model catalog for ${model.name}`} className="v-model-row">
            <div className="v-model-identity"><ProviderMark provider={model.provider} /><div><p className="v-model-provider">{model.provider}</p><h3>{model.name}</h3><p className="v-model-description">{model.description}</p></div></div>
            <dl className="v-model-specs"><div><dt>Context</dt><dd>{modelContext(model.contextWindow)}</dd></div><div><dt>Input / 1M</dt><dd>{modelPrice(model.inputPricePerMillion)}</dd></div><div><dt>Output / 1M</dt><dd>{modelPrice(model.outputPricePerMillion)}</dd></div></dl>
            <ChevronRight size={16} className="v-model-arrow" aria-hidden="true" />
          </Link>)}
        </div>}
      <p className="v-section-note">Prices in CNY. Availability reflects the current model catalog.</p>
    </section>
  );
}

