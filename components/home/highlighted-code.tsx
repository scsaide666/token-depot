// React escapes every token. No example content is interpreted as HTML.
export function HighlightedCode({ code }: { code: string }) {
  const parts = code.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:import|from|const|new|await|for|of|in|True|true|print)\b)/g);
  return <code>{parts.map((part, index) => {
    const kind = /^["']/.test(part) ? "v-syntax-string" : /^(import|from|const|new|await|for|of|in|True|true|print)$/.test(part) ? "v-syntax-keyword" : undefined;
    return kind ? <span className={kind} key={index}>{part}</span> : part;
  })}</code>;
}
