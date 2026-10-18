import { type ExampleLanguage, type LanguageExamples } from "@/lib/docs-content";
import { HighlightedCode } from "./highlighted-code";
import { CodeBody, CodeExampleFrame, RequestExampleTabs } from "./code-example-controls";

// Highlight documentation on the server; only copy and language controls hydrate.
export function CodeExample({ code, language, label }: { code: string; language: string; label: string }) {
  return <CodeExampleFrame code={code} language={language} label={label}>
    <CodeBody label={label}><HighlightedCode code={code} language={language} /></CodeBody>
  </CodeExampleFrame>;
}

export function RequestExamples({ examples, label = "Request example" }: { examples: LanguageExamples; label?: string }) {
  return <RequestExampleTabs examples={examples} label={label} panels={(Object.keys(examples) as ExampleLanguage[]).map(value => (
    <CodeBody key={value} label={`${examples[value].label} ${label.toLowerCase()}`}><HighlightedCode code={examples[value].code} language={value} /></CodeBody>
  ))} />;
}
