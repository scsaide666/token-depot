export type DocsSearchEntry = { id: string; title: string; section: string; text: string };
export function searchDocumentation(entries: DocsSearchEntry[], query: string) {
  const terms = query.toLocaleLowerCase("en-US").trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return entries.map(entry => {
    const text = entry.text.replace(/\s+/g, " ").trim();
    const title = entry.title.toLocaleLowerCase("en-US"), searchable = `${entry.section} ${entry.title} ${text}`.toLocaleLowerCase("en-US");
    if (!terms.every(term => searchable.includes(term))) return null;
    const first = text.toLocaleLowerCase("en-US").indexOf(terms[0]);
    const start = Math.max(0, first - 40);
    return { ...entry, excerpt: `${start ? "…" : ""}${text.slice(start, start + 180)}${text.length > start + 180 ? "…" : ""}`, score: terms.reduce((sum, term) => sum + (title.includes(term) ? 3 : 1), 0) };
  }).filter(entry => entry !== null).sort((a, b) => b.score - a.score).slice(0, 20);
}
