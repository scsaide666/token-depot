import { Button } from "@/components/ui/button";
export function DataSkeleton({ metrics = 4, chart = true }: { metrics?: number; chart?: boolean }) {
  return <div role="status" aria-label="Loading account data" className="space-y-6"><span className="sr-only">Loading account data…</span>
    <div aria-hidden="true" className={`grid grid-cols-2 gap-3 sm:gap-4 ${metrics === 5 ? "xl:grid-cols-5" : "lg:grid-cols-4"}`}>
      {Array.from({ length: metrics }, (_, index) => <div key={index} className="rounded-lg border border-border bg-card p-5"><div className="h-3 w-24 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" /><div className="mt-4 h-8 w-28 max-w-full rounded bg-[var(--skeleton)] motion-safe:animate-pulse" /></div>)}
    </div>
    {chart && <div aria-hidden="true" className="h-[350px] rounded-lg border border-border bg-card p-6"><div className="h-5 w-36 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" /><div className="mt-9 h-52 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" /></div>}
    <div aria-hidden="true" className="rounded-lg border border-border bg-card p-6"><div className="mb-6 h-5 w-36 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" />{Array.from({ length: 5 }, (_, index) => <div key={index} className="my-4 h-9 rounded bg-[var(--skeleton)] motion-safe:animate-pulse" />)}</div>
  </div>;
}
export function DataError({ message = "We couldn’t load your account data. Please try again.", onRetry, href }: { message?: string; onRetry?: () => void; href?: string }) {
  return <section role="alert" className="rounded-lg border border-border bg-card px-6 py-14 text-center"><h2 className="text-lg font-semibold tracking-[-0.025em]">Unable to load data</h2><p className="mt-2 text-sm text-muted-foreground">{message}</p>
    {onRetry && <Button variant="secondary" className="mt-5" onClick={onRetry}>Try again</Button>}
    {href && <Button asChild variant="secondary" className="mt-5"><a href={href}>Clear filters</a></Button>}
    {message.includes("session") && <a href="/login" className="mt-5 block text-sm text-link">Sign in</a>}
  </section>;
}
export function DataEmpty({ title, description }: { title: string; description: string }) {
  return <div className="border-t border-border px-5 py-14 text-center"><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p></div>;
}
