"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ComponentProps } from "react";
import { THEME_COLORS, THEME_STORAGE_KEY } from "@/lib/theme-config";

function BrowserThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    // Keep mobile browser chrome consistent with manual as well as system mode.
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => { meta.content = THEME_COLORS[resolvedTheme]; });
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem enableColorScheme storageKey={THEME_STORAGE_KEY} disableTransitionOnChange {...props}>
      <BrowserThemeColor />
      {children}
    </NextThemesProvider>
  );
}
