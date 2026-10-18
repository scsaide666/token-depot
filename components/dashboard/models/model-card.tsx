import type { MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCny, formatCount } from "@/lib/analytics-format";
import type { PublicModel } from "@/lib/model-types";
import { catalogCapabilities } from "./catalog-filters";
import { ModelCopyButton } from "./model-copy-button";
import { ProviderMark } from "@/components/brand-primitives";

export function ModelCard({ model, onViewDetails }: { model: PublicModel; onViewDetails: (model: PublicModel, event: MouseEvent<HTMLButtonElement>) => void }) {
  return <article className="console-model-card" aria-label={`${model.provider} ${model.name}`}>
    <header><span className="console-provider"><ProviderMark provider={model.provider} />{model.provider}</span><Badge variant="secondary" data-api-status="available">Available</Badge></header>
    <h2>{model.name}</h2><p className="console-model-description">{model.description || "No description provided."}</p>
    <div className="console-capabilities">{catalogCapabilities(model).map(capability => <Badge key={capability} variant="secondary">{capability}</Badge>)}</div>
    <dl><div><dt>Context</dt><dd>{formatCount(model.contextWindow)} tokens</dd></div><div><dt>Input / 1M</dt><dd>{formatCny(model.inputPricePerMillion)}</dd></div><div><dt>Output / 1M</dt><dd>{formatCny(model.outputPricePerMillion)}</dd></div></dl>
    <footer><ModelCopyButton id={model.slug} name={model.name} /><Button variant="outline" aria-haspopup="dialog" aria-label={`View details for ${model.name}`} onClick={event => onViewDetails(model, event)}>View details</Button></footer>
  </article>;
}
