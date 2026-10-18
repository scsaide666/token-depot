export default function Loading() {
  return <main aria-label="Loading Playground" aria-busy="true" className="mx-auto max-w-[1360px] px-4 py-12 sm:px-8"><div className="h-9 w-48 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none" /><div className="mt-8 grid gap-6 lg:grid-cols-[290px_minmax(0,1fr)]"><div className="h-48 animate-pulse rounded-[18px] bg-card lg:h-[640px] motion-reduce:animate-none" /><div className="h-[640px] animate-pulse rounded-[18px] bg-card motion-reduce:animate-none" /></div><span className="sr-only">Loading Playground…</span></main>;
}
