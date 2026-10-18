"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToastNotice } from "@/components/ui/feedback";
import { buildRequestExamples, type ExampleLanguage } from "@/lib/docs-content";
import type { PublicModel } from "@/lib/model-types";
import { HighlightedCode } from "@/components/home/highlighted-code";

const languages = [{ value: "curl", label: "curl" }, { value: "javascript", label: "JavaScript" }, { value: "python", label: "Python" }] as const;
export type QuickStartModel = Pick<PublicModel, "slug" | "name">;
export function DashboardQuickStart({ models, loadError, apiBaseUrl }: { models: QuickStartModel[]; loadError: boolean; apiBaseUrl: string }) {
  const [language, setLanguage] = useState<ExampleLanguage>("curl");
  const [modelSlug, setModelSlug] = useState(models[0]?.slug ?? "");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true), copySequence = useRef({ value: 0 });
  useEffect(() => {
    const sequenceState = copySequence.current;
    mounted.current = true;
    return () => { mounted.current = false; sequenceState.value++; if (timer.current) clearTimeout(timer.current); };
  }, []);
  const code = buildRequestExamples(apiBaseUrl, modelSlug || "YOUR_MODEL_ID")[language].code;
  const copied = copiedCode === code;
  async function copy(value: string, message: string, example = false) {
    const sequence = ++copySequence.current.value;
    try {
      await navigator.clipboard.writeText(value);
      if (!mounted.current || sequence !== copySequence.current.value) return;
      setNotice({ message, error: false }); setCopiedCode(example ? value : null);
    } catch {
      if (!mounted.current || sequence !== copySequence.current.value) return;
      setNotice({ message: "Could not copy. Select the text and copy it manually.", error: true }); setCopiedCode(null);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setNotice(null); setCopiedCode(null); }, 3500);
  }
  return (
    <section className="overview-quick-start" aria-labelledby="quick-start-heading">
      <div className="overview-section-header"><div><h2 id="quick-start-heading">Quick Start</h2><p>Connect your application to Token Depot.</p></div><Link href="/docs#getting-started" className="console-text-link">Read docs <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
      <div className="quick-start-layout">
        <div className="quick-start-guide">
          <ol><li><strong>Create an API key</strong><p>Save your key once and keep it on your server.</p><Link href="/dashboard/api-keys" className="console-text-link">Manage API keys <ArrowUpRight size={12} aria-hidden="true" /></Link></li><li><strong>Choose an available model</strong><p>Use the platform Model ID in your request.</p><Link href="/dashboard/models" className="console-text-link">Browse models <ArrowUpRight size={12} aria-hidden="true" /></Link></li><li><strong>Make your first request</strong><p>Set <code>AIHUB_API_KEY</code> and run the example. Usage is billed from your available balance.</p></li></ol>
          <div className="quick-start-base-url"><span>Base URL</span><div><code>{apiBaseUrl}</code><Button variant="ghost" size="icon-sm" onClick={() => void copy(apiBaseUrl, "Base URL copied.")} aria-label="Copy API base URL"><Copy size={13} aria-hidden="true" /></Button></div></div>
        </div>
        <div className="quick-start-example">
          <label className="quick-start-model"><span>Model ID</span><div><select aria-label="Quick start model" value={modelSlug} disabled={!models.length || loadError} onChange={event => setModelSlug(event.target.value)}><option value="" disabled>Select a model</option>{models.map(model => <option key={model.slug} value={model.slug}>{model.name} · {model.slug}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></div></label>
          <figure className="quick-start-terminal">
            <figcaption><span><Terminal size={13} aria-hidden="true" /> API request</span><button type="button" className="console-code-copy" onClick={() => void copy(code, "API example copied.", true)} aria-label="Copy API example">{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button></figcaption>
            <div className="quick-start-languages" role="group" aria-label="Quick start language">{languages.map(item => <button type="button" key={item.value} aria-pressed={language === item.value} onClick={() => setLanguage(item.value)}>{item.label}</button>)}</div>
            <pre tabIndex={0} aria-label={`${languages.find(item => item.value === language)?.label} example. Scroll to read all code.`}><HighlightedCode code={code} /></pre>
          </figure>
          {(loadError || !models.length) && <p className="quick-start-model-note" role="status">{loadError ? "Models could not be loaded. Refresh this page to try again." : "No models are available. Choose an enabled model before making a request."}</p>}
        </div>
      </div>
      <ToastNotice notice={notice} onDismiss={() => setNotice(null)} className="dashboard-console" />
    </section>
  );
}

