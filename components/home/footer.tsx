import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ThemeSwitch } from "@/components/theme-switch";
import { footerNavigation, type HomeDestination } from "@/lib/home-navigation";

export function HomeFooter({ onNavigate, sectionRoot = "" }: { onNavigate: (destination: HomeDestination) => void; sectionRoot?: "" | "/" }) {
  return (
    <footer id="footer" className="border-t border-border bg-background px-5 text-xs text-muted-foreground sm:px-8">
      <div className="mx-auto max-w-[var(--content-public)] pt-10 pb-6 sm:pt-12 sm:pb-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[1.6fr_1fr_1.2fr_1fr] md:gap-10">
          <div>
            <Link href="/" aria-label="Token Depot home" className="home-footer-link inline-flex items-center gap-2 text-base font-semibold tracking-[-0.035em] text-foreground"><BrandMark size={24} className="rounded-sm" />Token Depot</Link>
            <p className="mt-2 leading-relaxed">AI API Infrastructure</p>
          </div>
          {footerNavigation.map(({ title, links }) => (
            <nav key={title} aria-labelledby={`footer-${title.toLowerCase()}-heading`}>
              <h3 id={`footer-${title.toLowerCase()}-heading`} className="text-[13px] font-semibold text-foreground">{title}</h3>
              <ul className="mt-3 space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    {"href" in link ? (
                      <Link href={link.href.startsWith("#") ? `${sectionRoot}${link.href}` : link.href} className="home-footer-link inline-block leading-relaxed">{link.label}</Link>
                    ) : (
                      <button type="button" onClick={() => onNavigate(link.destination)} className="home-footer-link text-left leading-relaxed">{link.label}</button>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-start gap-5 md:mt-12 md:flex-row md:items-center md:justify-between md:gap-8">
          <p className="leading-relaxed">© 2026 Token Depot. All rights reserved.</p>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
            <button type="button" onClick={() => onNavigate("status")} className="home-footer-link leading-relaxed">System Status</button>
            <div className="flex items-center gap-3">
              <span>Theme</span>
              <ThemeSwitch language="en" />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
