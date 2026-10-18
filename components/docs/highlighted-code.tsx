import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

const languages: Record<string, string> = { curl: "bash", bash: "bash", python: "python", javascript: "javascript", "javascript / ts": "javascript", json: "json", http: "http" };

export function HighlightedCode({ code, language }: { code: string; language: string }) {
  const grammar = languages[language.toLowerCase()];
  if (!grammar) return <code>{code}</code>;
  // A longer fence prevents code containing Markdown fences from escaping its block.
  let fenceLength = 3;
  for (const match of code.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = "`".repeat(fenceLength);
  return <Markdown skipHtml rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={{ pre: ({ children }) => <>{children}</> }}>{`${fence}${grammar}\n${code}\n${fence}`}</Markdown>;
}
