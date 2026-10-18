export function ModelReferenceLoading() {
  return <div role="status" aria-label="Loading model reference" className="model-reference min-h-80 space-y-6 pt-6">
    <span className="sr-only">Loading model reference…</span>
    <div aria-hidden="true" className="h-6 w-28 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" />
    <div aria-hidden="true" className="grid grid-cols-2 gap-6">{[0, 1, 2, 3].map(key => <div key={key} className="h-14 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" />)}</div>
    <div aria-hidden="true" className="h-40 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" />
  </div>;
}
