"use client";

import { Info, KeyRound, Plus, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DemoToken } from "./token-table";
import { Section } from "./section";

export function ModalAndTooltip({ onOpenModal }: { onOpenModal: () => void }) {
  return (
    <>
      <Section id="modal" title="模态框" english="Modal / Dialog" description="让注意力聚焦在当前操作，完成后回到原处。">
        <div className="surface flex flex-col items-start justify-between gap-6 p-7 sm:flex-row sm:items-center sm:p-8">
          <div className="flex items-start gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary"><Plus className="size-5" strokeWidth={1.6} aria-hidden="true" /></div><div><h3 className="text-body font-semibold">创建一个示例 Token</h3><p className="mt-1.5 text-small text-muted-foreground">体验表单验证、确认操作与关闭行为。</p><p className="mt-3 text-caption text-muted-foreground">支持 Esc 关闭 · 焦点限制 · 返回触发位置</p></div></div>
          <Button onClick={onOpenModal} className="shrink-0">打开模态框</Button>
        </div>
      </Section>
      <Section id="tooltip" title="提示" english="Tooltip" description="补充说明，在需要时出现。">
        <div className="surface flex flex-wrap items-center gap-8 p-7 sm:p-8">
          <Tooltip><TooltipTrigger asChild><Button variant="outline"><KeyRound className="size-4" />访问凭证</Button></TooltipTrigger><TooltipContent side="top">用于识别项目的 API 访问凭证</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="查看安全说明"><ShieldCheck className="size-5" strokeWidth={1.6} /></Button></TooltipTrigger><TooltipContent side="bottom">请勿在前端代码中存放真实密钥</TooltipContent></Tooltip>
          <div className="flex items-center gap-2.5"><span className="text-small">什么是 Token？</span><Tooltip><TooltipTrigger asChild><button type="button" aria-label="解释 Token 用量" className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-250 hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Info className="size-4" /></button></TooltipTrigger><TooltipContent side="top" className="max-w-60 leading-relaxed">Token 是模型处理文本时使用的计量单位。</TooltipContent></Tooltip></div>
          <p className="text-caption text-muted-foreground sm:ml-auto">悬停或键盘聚焦以查看</p>
        </div>
      </Section>
    </>
  );
}

export function TokenDialog({ open, onOpenChange, onCreate, onRestoreFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; onCreate: (token: DemoToken) => void; onRestoreFocus: () => void;
}) {
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const error = attempted && !name.trim();

  function changeOpen(value: boolean) {
    setName("");
    setAttempted(false);
    onOpenChange(value);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      setAttempted(true);
      inputRef.current?.focus();
      return;
    }
    onCreate({
      id: crypto.randomUUID(), name: name.trim(), suffix: "demo · preview", state: "active", usage: "0",
      created: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    });
    changeOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
        <DialogHeader><div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary"><KeyRound className="size-5" strokeWidth={1.7} aria-hidden="true" /></div><DialogTitle>创建示例 Token</DialogTitle><DialogDescription className="pt-2 leading-relaxed">仅在当前页面添加一条示例记录，<br />不会生成真实访问密钥。</DialogDescription></DialogHeader>
        <form onSubmit={submit} noValidate>
          <div className="space-y-2.5 py-6"><Label htmlFor="new-token-name">名称</Label><Input ref={inputRef} id="new-token-name" placeholder="例如：我的开发环境" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error} aria-describedby={error ? "new-token-error" : "new-token-help"} /><p id="new-token-help" className="text-caption text-muted-foreground">最多 40 个字符。刷新页面后示例将重置。</p>{error && <p id="new-token-error" role="alert" className="text-small text-destructive">请输入 Token 名称。</p>}</div>
          <DialogFooter><Button variant="secondary" type="button" onClick={() => changeOpen(false)}>取消</Button><Button type="submit">创建示例</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
