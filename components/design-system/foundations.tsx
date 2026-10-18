"use client";

import { Check, Copy } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";
import { colorTokens, spacingTokens, typographyTokens } from "@/lib/design-tokens";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Section } from "./section";
const subscribe = () => () => {};
const borderToken = colorTokens.find(token => token.variable === "--border")!;

export function Foundations() {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  async function copyColor(value: string, name: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(name);
      setCopyMessage(`${name}色值 ${value} 已复制`);
    } catch {
      setCopyMessage(`无法访问剪贴板，请手动复制 ${value}`);
    }
  }

  return (
    <>
      <Section id="colors" title="颜色" english="Color tokens" description="蓝白色表面与清晰的蓝色交互，统一网站和开发者控制台。">
        <div className="surface p-6 sm:p-8">
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 sm:gap-6">
            {colorTokens.map((token) => {
              const value = mounted ? resolvedTheme === "dark" ? token.dark : token.light : token.variable;
              return (
                <Tooltip key={token.name}>
                  <TooltipTrigger asChild>
                    <button type="button" disabled={!mounted} onClick={() => copyColor(value, token.name)} aria-label={`复制${token.name}色值 ${value}`} className="group min-w-0 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-6 focus-visible:outline-ring">
                      <div className="relative mb-4 h-24 w-full rounded-xl border border-border transition-[filter] duration-250 group-hover:brightness-95 sm:h-28" style={{ backgroundColor: `var(${token.variable})` }}>
                        <span className="absolute right-2 bottom-2 flex size-6 items-center justify-center rounded-md bg-card/90 text-foreground opacity-0 transition-opacity duration-250 group-hover:opacity-100 group-focus-visible:opacity-100">
                          {copied === token.name ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                        </span>
                      </div>
                      <span className="block text-small font-medium">{token.name}</span>
                      <span className="mt-1 block truncate font-mono text-caption text-muted-foreground">{value}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{copied === token.name ? "已复制" : "点击复制色值"}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-caption text-muted-foreground">
            <span>Border <code className="ml-2 font-mono">{mounted ? resolvedTheme === "dark" ? borderToken.dark : borderToken.light : "--border"}</code></span>
            <span aria-live="polite">{copyMessage || "点击色块，复制色值"}</span>
          </div>
        </div>
      </Section>

      <Section id="typography" title="字体" english="Typography" description="清晰的层级，来自恰到好处的字号与字重。">
        <div className="surface grid overflow-hidden lg:grid-cols-[1fr_0.9fr]">
          <div className="flex min-h-72 flex-col justify-between p-7 sm:p-10">
            <span className="text-caption text-muted-foreground">Geist Sans / Geist Mono / 系统中文字体</span>
            <div className="py-8">
              <p className="text-[clamp(2.25rem,3.7vw,3.25rem)] leading-[1.15] font-semibold tracking-[-0.045em]">清晰。<br />恰到好处。</p>
              <p className="mt-5 max-w-64 text-body text-muted-foreground">让信息有序，让阅读轻松。<br />Token Depot · 为开发者而设计。</p>
              <p className="mt-5 font-mono text-sm tabular-nums">0123456789 · 1,000,000 tokens</p>
            </div>
            <div className="flex gap-8 text-caption text-muted-foreground"><span>标题 <span className="ml-1 text-foreground">600</span></span><span>正文 <span className="ml-1 text-foreground">400</span></span></div>
          </div>
          <div className="border-t border-border px-7 py-5 lg:border-t-0 lg:border-l">
            {typographyTokens.map((token) => (
              <div key={token.name} className="specimen-row flex min-h-12 items-center justify-between gap-3 py-3">
                <div className="min-w-0"><span className="text-small font-medium">{token.name}</span><code className="mt-0.5 block font-mono text-caption break-all text-muted-foreground">{token.variable}</code></div>
                <span className="shrink-0 text-caption text-muted-foreground">{token.size}px / {token.weight}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-caption text-muted-foreground">Display 最小 40px；正文行高 1.6，标题行高 1.1–1.4。中文回退至苹方、冬青黑体或微软雅黑；数值使用等宽数字。</p>
      </Section>

      <Section id="spacing" title="间距" english="Spacing & shape" description="以 4px 为基础，保持松弛而有秩序的布局节奏。">
        <div className="surface p-6 sm:p-8">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-8 sm:justify-between sm:gap-x-4">
            {spacingTokens.map((token) => (
              <div key={token.name} className="flex min-w-8 flex-col items-center gap-4">
                <div className="flex h-24 items-end"><div className="w-6 rounded-t-[5px] bg-foreground/85" style={{ height: `var(--${token.name})` }} /></div>
                <div className="text-center"><p className="text-small">{token.value}</p><p className="mt-1 font-mono text-caption text-muted-foreground">{token.name}</p></div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-5 border-t border-border pt-6">
            <span className="text-caption text-muted-foreground">圆角</span>
            {[{ value: 6, token: "--radius-control" }, { value: 8, token: "--radius-panel" }, { value: 12, token: "--radius-dialog" }].map((radius) => <div key={radius.value} className="flex items-center gap-3"><div className="size-10 border border-border bg-secondary" style={{ borderRadius: `var(${radius.token})` }} /><span className="text-caption text-muted-foreground">{radius.value}px</span></div>)}
            <span className="text-caption text-muted-foreground sm:ml-auto">交互动画 160 / 180 / 220ms</span>
          </div>
        </div>
      </Section>
    </>
  );
}
