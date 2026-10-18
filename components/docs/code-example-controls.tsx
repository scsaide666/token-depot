"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "radix-ui";
import { CodeCopyButton } from "@/components/home/code-copy-button";
import { type ExampleLanguage, type LanguageExamples } from "@/lib/docs-content";

export function CodeBody({ children, label }: { children: ReactNode; label: string }) {
  return <pre tabIndex={0} translate="no" aria-label={`${label}. Scroll horizontally to read the full code.`} className="docs-code overflow-x-auto px-4 py-5 font-mono text-[12px] leading-[1.85] sm:px-6 sm:py-6 sm:text-[13px]">{children}</pre>;
}

export function CodeExampleFrame({ code, language, label, children }: { code: string; language: string; label: string; children: ReactNode }) {
  return <figure aria-label={label} className="docs-code-window mt-5 min-w-0 overflow-hidden rounded-lg">
    <figcaption className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--code-border)] px-4 sm:px-6">
      <span className="text-xs text-[var(--code-muted)]">{language}</span><CodeCopyButton code={code} label={`Copy ${label}`} showLabel dark />
    </figcaption>
    {children}
  </figure>;
}

export function RequestExampleTabs({ examples, label, panels }: { examples: LanguageExamples; label: string; panels: ReactNode[] }) {
  const [language, setLanguage] = useState<ExampleLanguage>("curl");
  const languages = Object.keys(examples) as ExampleLanguage[];
  return <Tabs.Root value={language} onValueChange={(value) => { if (value === "curl" || value === "javascript" || value === "python") setLanguage(value); }} className="docs-code-window mt-5 min-w-0 overflow-hidden rounded-lg">
    <div className="flex min-h-14 items-center justify-between gap-1 border-b border-[var(--code-border)] px-3 sm:px-5">
      <Tabs.List aria-label={`${label} language`} className="flex min-w-0 gap-0.5">
        {languages.map((value) => <Tabs.Trigger key={value} value={value} className="min-h-10 rounded-[8px] px-2 text-[11px] text-[var(--code-muted)] transition-[color,background-color] duration-200 outline-none hover:text-[var(--code-foreground)] focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-[var(--code-secondary)] data-[state=active]:text-[var(--code-foreground)] sm:px-3 sm:text-xs">{examples[value].label}</Tabs.Trigger>)}
      </Tabs.List>
      <CodeCopyButton key={language} code={examples[language].code} label={`Copy ${examples[language].label} ${label.toLowerCase()}`} dark />
    </div>
    {languages.map((value, index) => <Tabs.Content forceMount key={value} value={value} hidden={language !== value} className="data-[state=inactive]:hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">{panels[index]}</Tabs.Content>)}
  </Tabs.Root>;
}
