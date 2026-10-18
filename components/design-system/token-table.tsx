"use client";

import { Check, KeyRound } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Section } from "./section";

export type DemoToken = { id: string; name: string; suffix: string; state: "active" | "paused" | "revoked"; usage: string; created: string };

export const initialTokens: DemoToken[] = [
  { id: "demo-1", name: "生产环境", suffix: "demo · 8f2a", state: "active", usage: "128,450", created: "2026-10-01" },
  { id: "demo-2", name: "本地开发", suffix: "demo · 3c9e", state: "active", usage: "24,800", created: "2026-09-28" },
  { id: "demo-3", name: "测试项目", suffix: "demo · 7b1d", state: "paused", usage: "6,320", created: "2026-09-24" },
];

export function TokenTable({ tokens, onOpenModal }: { tokens: DemoToken[]; onOpenModal: () => void }) {
  const [empty, setEmpty] = useState(false);
  return (
    <Section id="table" title="表格" english="Table" description="整齐对齐的信息，克制的分隔与状态标记。">
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6 sm:px-8"><div className="flex items-center gap-3"><h3 className="text-body font-semibold">Token 列表</h3><Badge variant="secondary">示例数据</Badge></div><div role="group" aria-label="表格状态预览" className="flex gap-1 rounded-full bg-secondary p-1">{[{ label: "数据", value: false }, { label: "空状态", value: true }].map((item) => <button type="button" key={item.label} onClick={() => setEmpty(item.value)} aria-pressed={empty === item.value} className={cn("rounded-full px-3 py-1.5 text-caption transition-[background-color,color,box-shadow] duration-250 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", empty === item.value ? "bg-card text-foreground shadow-xs" : "text-muted-foreground")}>{item.label}</button>)}</div></div>
        {empty ? <div className="flex min-h-64 flex-col items-center justify-center border-t border-border px-6 py-10 text-center"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary"><KeyRound className="size-5 text-muted-foreground" aria-hidden="true" /></div><h4 className="text-body">还没有 Token</h4><p className="mt-2 text-small text-muted-foreground">创建一个示例，预览列表中的展示效果。</p><Button variant="outline" onClick={() => { setEmpty(false); onOpenModal(); }} className="mt-5" size="sm">创建示例 Token</Button></div> : <Table>
          <TableCaption className="m-0 border-t border-border px-6 py-4 text-left text-caption sm:px-8">{tokens.length} 个示例 Token · 所有数据仅用于界面展示</TableCaption>
          <TableHeader><TableRow className="bg-background/60 hover:bg-background/60"><TableHead className="pl-6 sm:pl-8">名称</TableHead><TableHead>状态</TableHead><TableHead className="text-right">已用 Tokens</TableHead><TableHead className="pr-6 text-right sm:pr-8">创建日期</TableHead></TableRow></TableHeader>
          <TableBody>{tokens.map((token) => <TableRow key={token.id}><TableCell className="min-w-40 py-5 pl-6 sm:pl-8"><p className="text-small font-medium">{token.name}</p><p className="mt-1 font-mono text-caption text-muted-foreground">{token.suffix}</p></TableCell><TableCell><Badge variant={token.state === "active" ? "active" : "secondary"}>{token.state === "active" ? <><Check className="size-3" />已启用</> : token.state === "paused" ? "已暂停" : "已撤销"}</Badge></TableCell><TableCell className="text-right text-small tabular-nums">{token.usage}</TableCell><TableCell className="pr-6 text-right text-small whitespace-nowrap text-muted-foreground tabular-nums sm:pr-8">{token.created}</TableCell></TableRow>)}</TableBody>
        </Table>}
      </div>
    </Section>
  );
}
