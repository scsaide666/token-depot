import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
import { NO_INDEX, siteConfiguration } from "@/lib/seo";
import { THEME_COLORS } from "@/lib/theme-config";
import fontPreloads from "@/lib/font-preloads.json";

// Keep the existing bundled fonts, variables and fallback metrics. Explicit
// resource hints cover builds where the automatic font manifest is empty.
const GeistSans = localFont({
  src: "../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-geist-sans", weight: "100 900", display: "swap", preload: true,
});
const GeistMono = localFont({
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono", weight: "100 900", display: "swap", preload: true,
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Roboto Mono", "Menlo", "Monaco", "Liberation Mono", "DejaVu Sans Mono", "Courier New", "monospace"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfiguration().origin),
  applicationName: "Token Depot",
  appleWebApp: { title: "Token Depot" },
  title: { default: "Token Depot · AI API Infrastructure", template: "%s · Token Depot" },
  description: "Token Depot AI API 平台：模型调用、Token 用量与按量计费。",
  robots: NO_INDEX,
  icons: { icon: [{ url: "/favicon.ico?v=td-3", sizes: "any" }, { url: "/icon.png?v=td-3", type: "image/png", sizes: "256x256" }], apple: "/apple-icon.png?v=td-3" },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>{fontPreloads.map(href => <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />)}</head>
      <body className="font-sans antialiased">
        <ThemeProvider nonce={nonce}>
          <TooltipProvider delayDuration={300}>
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
