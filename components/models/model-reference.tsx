"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ProviderMark } from "@/components/brand-primitives";
import { Badge } from "@/components/ui/badge";
import { ModelCopyButton } from "@/components/dashboard/models/model-copy-button";
import { ClientRequestExamples as RequestExamples } from "@/components/docs/client-request-examples";
import { buildRequestExamples } from "@/lib/docs-content";
import { modelContext, modelPrice, type PublicModel } from "@/lib/model-types";

const subscribe = () => () => {};
const serverBaseUrl = () => "https://YOUR_API_DOMAIN/v1";
const clientBaseUrl = () => `${window.location.origin}/v1`;

export function ModelReference({ model }: { model: PublicModel }) {
  // Hydration-safe current platform origin, never a private routing URL.
  const baseUrl = useSyncExternalStore(subscribe, clientBaseUrl, serverBaseUrl);
  return <div className="model-reference">
    <div className="model-reference-provider"><ProviderMark provider={model.provider} /><span>{model.provider}</span><Badge variant="secondary">Enabled</Badge></div>
    <section aria-label="Model identifier" className="mt-6"><h3 className="text-xs font-medium">Model ID</h3><ModelCopyButton key={model.slug} id={model.slug} name={model.name} /></section>
    <dl className="model-reference-specs">
      <div><dt>Input / 1M tokens</dt><dd>{modelPrice(model.inputPricePerMillion)}</dd></div>
      <div><dt>Output / 1M tokens</dt><dd>{modelPrice(model.outputPricePerMillion)}</dd></div>
      <div><dt>Context window</dt><dd>{modelContext(model.contextWindow)}<small>tokens</small></dd></div>
      <div><dt>Availability</dt><dd className="model-reference-availability">Enabled in catalog<small>Upstream health may vary.</small></dd></div>
    </dl>
    <section aria-label="Supported features"><h3 className="text-sm font-medium">Supported features</h3><div className="mt-3 flex flex-wrap gap-2">{["Text chat", "SSE streaming", "System prompt"].map(feature => <Badge key={feature} variant="secondary">{feature}</Badge>)}{model.contextWindow >= 128000 && <Badge variant="secondary">Long context · 128K+</Badge>}</div><p className="model-reference-note">These are supported by the Token Depot text chat endpoint. Images, tools and function calling are not implemented. Sampling controls vary; Playground shows the parameters supported for your selected model.</p></section>
    <section aria-label="API usage example" className="mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">API usage</h3><Link href="/playground" className="docs-inline-link text-xs">Try in Playground</Link></div><p className="model-reference-note">Set AIHUB_API_KEY on your server. Examples use this deployment and the public Model ID.</p><RequestExamples key={model.slug} examples={buildRequestExamples(baseUrl, model.slug)} label={`${model.name} example`} /></section>
    <p className="model-reference-note">Published selling prices in CNY. <Link href="/docs#billing" className="docs-inline-link">Usage & billing</Link></p>
  </div>;
}
