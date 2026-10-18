import type { ReactNode } from "react";

export function Section({ id, title, english, description, children }: {
  id: string; title: string; english: string; description: string; children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="section-anchor">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-heading">{title}</h2>
          <p className="mt-2 text-small text-muted-foreground">{description}</p>
        </div>
        <span className="pb-0.5 text-caption text-muted-foreground">{english}</span>
      </div>
      {children}
    </section>
  );
}
