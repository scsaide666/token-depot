import type { ReactNode } from "react";

export function SettingsSection({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="settings-section min-w-0 scroll-mt-24 border-t border-border first:border-t-0">
      <div>
        <h2 id={`${id}-title`} className="ui-section-title">{title}</h2>
        <p className="mt-2 max-w-[36ch] text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
