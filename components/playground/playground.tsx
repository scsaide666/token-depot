"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, ChevronDown, SlidersHorizontal, Square, Trash2 } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeSwitch } from "@/components/theme-switch";
import { ProviderMark, TokenUsageBreakdown } from "@/components/brand-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeCopyButton } from "@/components/home/code-copy-button";
import type { PlaygroundModel, PlaygroundStats } from "@/lib/playground-types";
import { modelContext, modelPrice } from "@/lib/model-types";
import { confirmedActualCost, estimatedOutputBudget } from "@/lib/developer-presentation";
import { cn } from "@/lib/utils";
const MessageContent = dynamic(() => import("./message-content").then(module => module.MessageContent));
import { usePlayground } from "./use-playground";

const field = "w-full rounded-sm border border-input bg-card px-3.5 py-3 text-sm leading-relaxed outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:opacity-50";
export function UsageStats({ stats, busy }: { stats: PlaygroundStats | null; busy: boolean }) {
  const values = [
    ["Input tokens", stats?.inputTokens?.toLocaleString("en-US") ?? "—"],
    ["Output tokens", stats?.outputTokens?.toLocaleString("en-US") ?? "—"],
    ["Total tokens", stats?.totalTokens?.toLocaleString("en-US") ?? "—"],
    ["Latency", stats?.latencyMs === null || stats?.latencyMs === undefined ? "—" : `${stats.latencyMs.toLocaleString("en-US")} ms`],
    ["Actual cost", confirmedActualCost(stats) ?? "—"],
  ];
  return <div className="playground-usage border-t border-border px-5 py-5 sm:px-7">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>Last request · CNY</span><span role="status">{busy ? "Confirming usage…" : stats ? stats.status === "SUCCESS" ? "Settled" : stats.status === "FAILED" ? "Failed · no charge" : "Settlement pending" : "Usage appears after your first request"}</span></div>
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-5">{values.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="aihub-token-value mt-1 text-[13px] break-all" data-stat={label}>{value}</dd></div>)}</dl>
    <TokenUsageBreakdown input={stats?.inputTokens ?? null} output={stats?.outputTokens ?? null} />
    {stats?.requestId && <p className="mt-3 font-mono text-[10px] text-muted-foreground [overflow-wrap:anywhere]">Request ID: {stats.requestId}</p>}
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Actual cost appears only after confirmed token usage and successful settlement.</p>
  </div>;
}

export function Playground({ models, initialBalance, loadError = false }: { models: PlaygroundModel[]; initialBalance: string; loadError?: boolean }) {
  const [slug, setSlug] = useState(models[0]?.slug ?? "");
  const model = models.find(item => item.slug === slug);
  const [system, setSystem] = useState("");
  const [temperature, setTemperature] = useState(model?.parameters.temperature?.default ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(model?.parameters.defaultOutputTokens ?? 512);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const clearTrigger = useRef<HTMLButtonElement>(null), clearCancel = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const conversation = usePlayground(initialBalance);
  const messages = useDeferredValue(conversation.messages);
  const viewport = useRef<HTMLDivElement>(null), follow = useRef(true);
  useEffect(() => { if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [messages]);
  const busy = conversation.busy;
  const validSettings = !!model && Number.isInteger(maxTokens) && maxTokens >= 1 && maxTokens <= model.parameters.maxOutputTokens &&
    (!model.parameters.temperature || (Number.isFinite(temperature) && temperature >= model.parameters.temperature.min && temperature <= model.parameters.temperature.max));

  function changeModel(value: string) {
    const next = models.find(item => item.slug === value); if (!next) return;
    setSlug(value); setTemperature(next.parameters.temperature?.default ?? 0.7); setMaxTokens(next.parameters.defaultOutputTokens);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validSettings || busy || !draft.trim() || !model) return;
    const content = draft; setDraft("");
    const accepted = await conversation.send({ model: model.slug, system, content, max_tokens: maxTokens,
      ...(model.parameters.temperature ? { temperature } : {}) });
    if (!accepted) setDraft(content);
  }
  return <div lang="en" className="developer-playground min-h-dvh bg-background">
    <a href="#playground-content" className="skip-link">Skip to playground</a>
    <header className="border-b border-border bg-card"><div className="mx-auto flex min-h-16 max-w-[var(--content-developer)] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-8">
      <Brand name="Token Depot" /><nav aria-label="Playground navigation" className="flex items-center gap-3 text-xs text-muted-foreground sm:gap-6"><Link href="/docs" className="transition-colors hover:text-foreground">Docs</Link><Link href="/dashboard" className="transition-colors hover:text-foreground">Dashboard</Link><ThemeSwitch language="en" /></nav>
    </div></header>
    <main id="playground-content" tabIndex={-1} className="mx-auto max-w-[var(--content-developer)] px-4 pt-8 pb-12 outline-none sm:px-8 sm:pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="ui-page-title">Playground</h1><p className="ui-page-description">Explore models. Build a conversation.</p></div><Link href="/dashboard/billing" className="text-right text-xs text-muted-foreground"><span className="block">Available balance</span><span className="mt-1 block text-base font-medium text-foreground tabular-nums" data-testid="playground-balance">{conversation.balance}</span></Link></div>
      <div className="playground-workspace grid items-start gap-5 lg:grid-cols-[290px_minmax(0,1fr)] lg:gap-6">
        <aside aria-label="Model settings" className="min-w-0 rounded-lg border border-border/70 bg-card">
          <div className="flex items-center justify-between px-5 pt-5 pb-4"><h2 className="text-sm font-semibold tracking-[-0.015em]">Configuration</h2><button type="button" aria-label="Toggle model settings" aria-expanded={settingsOpen} aria-controls="playground-settings" onClick={() => setSettingsOpen(!settingsOpen)} className="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground lg:hidden"><SlidersHorizontal className="size-4" strokeWidth={1.6} aria-hidden="true" /></button></div>
          <div className="px-5 pb-5">
            <div><label htmlFor="playground-model" className="text-xs font-medium">Model</label><div className="relative mt-2"><select id="playground-model" disabled={busy || !models.length} value={slug} onChange={event => changeModel(event.target.value)} className={cn(field, "h-11 appearance-none py-0 pr-9")}>
              {!models.length && <option value="">No models available</option>}{models.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
            </select><ChevronDown className="pointer-events-none absolute top-3.5 right-3 size-4 text-muted-foreground" aria-hidden="true" /></div>
              {model && <div className="mt-3 flex min-w-0 items-center gap-2"><ProviderMark provider={model.provider} /><p className="min-w-0 text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{model.provider} · {modelContext(model.contextWindow)} context<br /><span className="font-mono">{model.slug}</span></p></div>}
            </div>
          </div>
          <div id="playground-settings" className={cn("space-y-5 border-t border-border px-5 pt-5 pb-6", !settingsOpen && "hidden lg:block")}>
            <div><label htmlFor="playground-system" className="text-xs font-medium">System prompt <span className="font-normal text-muted-foreground">· optional</span></label><textarea id="playground-system" value={system} onChange={event => setSystem(event.target.value)} disabled={busy} maxLength={32768} rows={5} placeholder="Set the tone and behavior of the model." className={cn(field, "mt-2 resize-y")} /></div>
            {model?.parameters.temperature && <div><div className="flex items-center justify-between gap-3"><label htmlFor="playground-temperature" className="text-xs font-medium">Temperature</label><span className="text-[11px] text-muted-foreground">{model.parameters.temperature.min}–{model.parameters.temperature.max}</span></div><Input id="playground-temperature" type="number" min={model.parameters.temperature.min} max={model.parameters.temperature.max} step="0.1" value={Number.isNaN(temperature) ? "" : temperature} onChange={event => setTemperature(event.target.value === "" ? NaN : Number(event.target.value))} disabled={busy} className="mt-2 font-mono text-sm" /><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Lower values make replies more focused.</p></div>}
            <div><label htmlFor="playground-max-tokens" className="text-xs font-medium">Max output tokens</label><Input id="playground-max-tokens" type="number" min="1" max={model?.parameters.maxOutputTokens ?? 4096} step="1" value={Number.isNaN(maxTokens) ? "" : maxTokens} onChange={event => setMaxTokens(event.target.value === "" ? NaN : Number(event.target.value))} disabled={busy || !model} className="mt-2 font-mono text-sm" /><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{model ? `Up to ${model.parameters.maxOutputTokens.toLocaleString("en-US")} tokens. Your available balance is reserved before sending.` : "Select an available model to configure the output limit."}</p></div>
            {model && <div className="playground-price-reference border-t border-border pt-4"><dl><div><dt>Input / 1M</dt><dd>{modelPrice(model.inputPricePerMillion)}</dd></div><div><dt>Output / 1M</dt><dd>{modelPrice(model.outputPricePerMillion)}</dd></div></dl><p className="mt-4 text-xs">Estimated output budget <span className="block pt-1 font-mono tabular-nums">{validSettings ? estimatedOutputBudget(model.outputPricePerMillion, maxTokens) ?? "—" : "—"}</span></p><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Output limit × published output price. Excludes input tokens; this is not the wallet reservation or final charge.</p><Link href="/pricing" className="docs-inline-link mt-3 inline-block text-xs">View pricing</Link></div>}
          </div>
        </aside>
        <section aria-label="Conversation" className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="playground-conversation-header flex min-h-16 items-center justify-between gap-3 border-b border-border px-5 sm:px-7"><div className="flex flex-wrap items-center gap-3"><h2 className="text-sm font-semibold">Conversation</h2><span role="status" className="playground-request-status">{conversation.phase === "generating" ? "Streaming" : conversation.phase === "stopping" ? "Stopping" : conversation.phase === "settling" ? "Settling" : conversation.error ? "Request needs attention" : conversation.stats?.status === "SUCCESS" ? "Completed" : conversation.stats?.status === "FAILED" ? "Failed" : "Ready"}</span></div><Button ref={clearTrigger} variant="ghost" size="sm" disabled={busy || !conversation.messages.length} onClick={() => setClearOpen(true)} className="h-11 gap-2 px-2 text-xs text-muted-foreground"><Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />Clear conversation</Button></div>
          <div ref={viewport} onScroll={event => { const target = event.currentTarget; follow.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80; }} className="playground-conversation max-h-[60dvh] min-h-[340px] overflow-y-auto overscroll-contain px-5 py-7 sm:min-h-[400px] sm:px-7" aria-busy={busy}>
            {!messages.length ? <div className="flex min-h-[280px] flex-col justify-center"><h3 className="text-[24px] font-semibold tracking-[-0.035em]">A place to start building.</h3><p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">{loadError ? "The model catalog couldn’t be loaded. Refresh to try again." : !models.length ? "No configured models are available yet. An administrator can enable a model and its provider channel." : "Choose a model, add a prompt, and see the response as it arrives."}</p>{!loadError && !!models.length && <p className="mt-5 text-xs text-muted-foreground">This conversation stays in this tab.</p>}</div> :
              <div className="space-y-8">{messages.map(message => <article key={message.id} className="min-w-0"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-xs font-semibold">{message.role === "user" ? "You" : "Assistant"}</h3>{message.role === "assistant" && message.content && message.state !== "streaming" && <CodeCopyButton code={message.content} label="Copy response" successMessage="Response copied." showLabel />}</div>
                {message.role === "user" ? <p className="text-sm leading-7 whitespace-pre-wrap break-words">{message.content}</p> : message.content ? <MessageContent content={message.content} /> : <p className="text-sm text-muted-foreground">{message.state === "streaming" ? "Waiting for the model…" : "No response content."}</p>}
                {message.role === "assistant" && (message.state === "stopped" || message.state === "failed") && <p className="mt-3 text-[11px] text-muted-foreground">{message.state === "stopped" ? "Generation stopped." : "Request interrupted."} Check the request statistics below.</p>}
              </article>)}</div>}
          </div>
          {conversation.error && <div role="alert" className="mx-5 mb-4 rounded-sm border border-border bg-background px-4 py-3 text-xs leading-relaxed sm:mx-7"><p>{conversation.error.message}</p>{conversation.error.code === "insufficient_balance" ? <Link href="/dashboard/billing" className="mt-2 inline-block text-link hover:underline">Add balance in Billing</Link> : <Link href="/dashboard/usage" className="mt-2 inline-block text-link hover:underline">View request history</Link>}</div>}
          <form ref={formRef} onSubmit={submit} className="border-t border-border px-5 py-5 sm:px-7"><label htmlFor="playground-message" className="sr-only">Message</label><textarea id="playground-message" name="message" rows={3} maxLength={32768} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy || !model} placeholder="Send a message…" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !busy) { event.preventDefault(); formRef.current?.requestSubmit(); } }} className={cn(field, "min-h-[100px] resize-y bg-background/50")} />
            <div className="playground-send-actions mt-3 flex min-h-11 items-center justify-between gap-3"><p className="max-w-[210px] text-[11px] leading-relaxed text-muted-foreground">{busy ? conversation.phase === "settling" ? "Confirming settlement…" : conversation.phase === "stopping" ? "Stopping generation…" : "Receiving response…" : "Enter to send · Shift + Enter for a new line"}</p>
              {busy ? <Button type="button" variant="secondary" onClick={conversation.stop} disabled={conversation.phase !== "generating"} loading={conversation.phase !== "generating"} className="gap-2 text-xs">{conversation.phase === "generating" && <Square className="size-3" fill="currentColor" aria-hidden="true" />}{conversation.phase === "settling" ? "Confirming usage…" : conversation.phase === "stopping" ? "Stopping…" : "Stop generation"}</Button> : <Button type="submit" disabled={!draft.trim() || !validSettings} className="gap-2 text-xs">Send<ArrowUp className="size-4" aria-hidden="true" /></Button>}
            </div>
          </form>
          <UsageStats stats={conversation.stats} busy={conversation.phase === "settling"} />
        </section>
      </div>
      <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">Model output can be inaccurate. Usage is settled from confirmed upstream token counts. <Link href="/docs#billing" className="hover:text-foreground hover:underline">How billing works</Link></p>
      <Dialog open={clearOpen} onOpenChange={setClearOpen}><DialogContent lang="en" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); clearCancel.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); if (clearTrigger.current && !clearTrigger.current.disabled) clearTrigger.current.focus(); else document.getElementById("playground-content")?.focus({ preventScroll: true }); }}><DialogHeader><DialogTitle>Clear conversation?</DialogTitle><DialogDescription>The messages in this tab will be removed. This cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button ref={clearCancel} variant="secondary" onClick={() => setClearOpen(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => { conversation.clear(); setClearOpen(false); }}>Clear conversation</Button></DialogFooter></DialogContent></Dialog>
    </main>
  </div>;
}
