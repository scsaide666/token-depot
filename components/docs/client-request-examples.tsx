"use client";

import { type ExampleLanguage, type LanguageExamples } from "@/lib/docs-content";
import { CodeBody, RequestExampleTabs } from "./code-example-controls";
import { HighlightedCode } from "./highlighted-code";

// Used only inside the model reference, which is loaded when its dialog opens.
export function ClientRequestExamples({ examples, label = "Request example" }: { examples: LanguageExamples; label?: string }) {
  return <RequestExampleTabs examples={examples} label={label} panels={(Object.keys(examples) as ExampleLanguage[]).map(value => (
    <CodeBody key={value} label={`${examples[value].label} ${label.toLowerCase()}`}><HighlightedCode code={examples[value].code} language={value} /></CodeBody>
  ))} />;
}
