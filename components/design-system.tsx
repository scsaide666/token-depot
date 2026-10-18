"use client";

import { ArrowUp, Blocks, Layers2, MessageSquare, MousePointer2, Palette, PanelTop, Ruler, Square, Table2, Tag, TextCursorInput, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { ThemeSwitch } from "@/components/theme-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Foundations } from "./design-system/foundations";
import { ButtonsAndInputs } from "./design-system/buttons-inputs";
import { CardsAndBadges } from "./design-system/cards-badges";
import { ModalAndTooltip, TokenDialog } from "./design-system/modal-tooltip";
import { initialTokens, TokenTable, type DemoToken } from "./design-system/token-table";
import { BrandFoundation } from "./design-system/brand-foundation";

const groups = [
  { title: "设计基础", items: [{ id: "brand", name: "品牌", icon: Layers2 }, { id: "colors", name: "颜色", icon: Palette }, { id: "typography", name: "字体", icon: Type }, { id: "spacing", name: "间距", icon: Ruler }] },
  { title: "基础组件", items: [{ id: "buttons", name: "按钮", icon: MousePointer2 }, { id: "inputs", name: "输入框", icon: TextCursorInput }, { id: "cards", name: "卡片", icon: Square }, { id: "badges", name: "标签", icon: Tag }, { id: "table", name: "表格", icon: Table2 }, { id: "modal", name: "模态框", icon: PanelTop }, { id: "tooltip", name: "提示", icon: MessageSquare }] },
];

export function DesignSystem() {
  const [active, setActive] = useState("brand");
  const [modalOpen, setModalOpen] = useState(false);
  const [tokens, setTokens] = useState<DemoToken[]>(initialTokens);
  const [announcement, setAnnouncement] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const items = groups.flatMap((group) => group.items);
    let frame = 0;
    function updateActive() {
      frame = 0;
      let current = items[0].id;
      for (const item of items) {
        const element = document.getElementById(item.id);
        if (element && element.getBoundingClientRect().top <= Math.max(160, window.innerHeight * 0.25)) current = item.id;
        else break;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = items[items.length - 1].id;
      setActive(current);
    }
    function scheduleUpdate() {
      if (!frame) frame = requestAnimationFrame(updateActive);
    }
    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  function openModal() {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setModalOpen(true);
  }

  function createToken(token: DemoToken) {
    setTokens((current) => [token, ...current]);
    setAnnouncement(`示例「${token.name}」已添加到 Token 列表。`);
  }

  return (
    <>
      <a href="#main-content" className="skip-link">跳转到内容</a>
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
          <div className="flex items-center gap-5"><Brand /><span className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" /><span className="hidden text-small text-muted-foreground sm:inline">Design system</span></div>
          <div className="flex items-center gap-7"><a href="#buttons" className="hidden rounded-md text-small text-muted-foreground transition-colors duration-250 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:inline">浏览组件</a><ThemeSwitch /></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-5 pb-3 lg:hidden" aria-label="设计系统章节">
          {groups.flatMap((group) => group.items).map((item) => <a key={item.id} href={`#${item.id}`} onClick={() => setActive(item.id)} aria-current={active === item.id ? "location" : undefined} className="nav-link shrink-0 rounded-full px-3 py-2 text-caption text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{item.name}</a>)}
        </nav>
      </header>

      <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-12 px-5 sm:px-8 lg:grid-cols-[168px_minmax(0,1fr)] lg:gap-16 lg:px-12">
        <aside className="sticky top-32 hidden h-[calc(100dvh-160px)] flex-col justify-between pt-2 pb-5 lg:flex">
          <nav aria-label="设计系统目录" className="space-y-8">
            {groups.map((group) => <div key={group.title}><p className="mb-3 px-3 text-caption text-muted-foreground">{group.title}</p><ul className="space-y-1">{group.items.map(({ id, name, icon: Icon }) => <li key={id}><a href={`#${id}`} onClick={() => setActive(id)} aria-current={active === id ? "location" : undefined} className="nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-small text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Icon className="size-4" strokeWidth={1.65} aria-hidden="true" />{name}</a></li>)}</ul></div>)}
          </nav>
          <div className="px-3 text-caption text-muted-foreground"><p className="flex items-center gap-2"><Layers2 className="size-3.5" aria-hidden="true" />Token Depot UI</p><p className="mt-2">Brand foundation</p></div>
        </aside>

        <main id="main-content" className="min-w-0 pt-12 pb-12 sm:pt-16 lg:pt-16">
          <div className="mb-14 sm:mb-16">
            <div className="mb-5 flex items-center gap-3"><span className="text-small text-muted-foreground">Token Depot Design System</span><Badge variant="outline" className="font-normal">Geist</Badge></div>
            <h1 className="text-display font-semibold">设计系统。</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">一致的视觉语言。更专注的产品体验。<br className="hidden sm:block" />从颜色到交互，构建清晰、自然的每一步。</p>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-caption text-muted-foreground"><span className="flex items-center gap-2"><Blocks className="size-3.5" aria-hidden="true" />统一基础组件</span><span className="flex items-center gap-2"><Palette className="size-3.5" aria-hidden="true" />品牌 / 颜色 / 字体 / 间距</span><span>Light / Dark / System</span></div>
          </div>

          <div className="space-y-16 sm:space-y-20">
            <BrandFoundation />
            <Foundations />
            <ButtonsAndInputs />
            <CardsAndBadges onOpenModal={openModal} />
            <TokenTable tokens={tokens} onOpenModal={openModal} />
            <ModalAndTooltip onOpenModal={openModal} />
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-between gap-5 border-t border-border pt-6 text-caption text-muted-foreground"><p>Token Depot Design System · Brand foundation</p><Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground"><a href="#main-content">回到顶部<ArrowUp className="size-3.5" aria-hidden="true" /></a></Button></div>
        </main>
      </div>
      <TokenDialog open={modalOpen} onOpenChange={setModalOpen} onCreate={createToken} onRestoreFocus={() => triggerRef.current?.focus()} />
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </>
  );
}
