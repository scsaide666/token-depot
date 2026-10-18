import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main lang="en" className="auth-shell flex min-h-dvh items-center justify-center bg-background px-6 py-12 sm:px-8 sm:py-20">
      <div className="w-full max-w-[var(--content-auth)]">
        <div className="auth-enter-logo mb-8 flex justify-center"><Brand name="Token Depot" variant="auth" /></div>
        <header className="auth-enter-heading text-center">
          <h1 className="text-[28px] leading-[1.16] font-semibold tracking-[-0.04em] text-balance sm:text-[32px]">{title}</h1>
          <p className="mx-auto mt-3 max-w-[360px] text-[15px] leading-relaxed text-pretty text-muted-foreground">{description}</p>
        </header>
        <div className="auth-enter-form mt-8">{children}</div>
      </div>
    </main>
  );
}
