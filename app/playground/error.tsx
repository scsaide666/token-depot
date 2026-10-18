"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function Error({ retry }: { retry: () => void }) {
  return <main lang="en" className="mx-auto max-w-lg px-6 py-24"><h1 className="text-2xl font-semibold tracking-tight">Playground unavailable</h1><p className="mt-4 text-sm leading-relaxed text-muted-foreground">We couldn’t load your account or model settings. Try again shortly.</p><div className="mt-6 flex gap-3"><Button onClick={retry}>Try again</Button><Button asChild variant="secondary"><Link href="/dashboard">Back to dashboard</Link></Button></div></main>;
}
