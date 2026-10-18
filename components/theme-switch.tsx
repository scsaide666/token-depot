"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { themeOptions } from "@/lib/theme-config";

const subscribe = () => () => {};
const icons = { light: Sun, dark: Moon, system: Monitor };

export function ThemeSwitch({ language = "zh" }: { language?: "zh" | "en" }) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  return (
    <div className="aihub-theme-control" role="group" aria-label={language === "en" ? "Theme mode" : "主题模式"}>
      {themeOptions.map(({ value, chineseLabel, accessibleLabel }) => {
        const Icon = icons[value];
        const label = language === "en" ? accessibleLabel : chineseLabel;
        return (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-pressed={mounted && theme === value}
              onClick={() => setTheme(value)}
              className={cn(
                "flex items-center justify-center text-muted-foreground ui-pressable hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                mounted && theme === value && "bg-card text-foreground",
              )}
            >
              <Icon className="size-4" strokeWidth={1.7} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ); })}
    </div>
  );
}
