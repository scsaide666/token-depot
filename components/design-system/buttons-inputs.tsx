"use client";

import { Check, Eye, EyeOff, Info, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "./section";

export function ButtonsAndInputs() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function saveDemo() {
    setSaving(true);
    setSaved(false);
    timer.current = setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setFeedback("演示更改已保存");
    }, 650);
  }

  return (
    <>
      <Section id="buttons" title="按钮" english="Button" description="明确的主次关系，完整的交互状态。">
        <div className="surface px-6 sm:px-8">
          <div className="specimen-row flex flex-col gap-5 py-7 sm:flex-row sm:items-center"><span className="w-24 shrink-0 text-caption text-muted-foreground">样式</span><div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveDemo} loading={saving}>{saved ? <Check /> : null}{saving ? "保存中" : saved ? "已保存" : "保存更改"}</Button>
            <Button variant="secondary" onClick={() => setFeedback("已选择次要操作")}>次要按钮</Button>
            <Button variant="outline" onClick={() => setFeedback("已选择边框按钮")}>边框按钮</Button>
            <Button variant="ghost" onClick={() => setFeedback("已选择轻量操作")}>轻量按钮</Button>
            <Button variant="link" asChild><a href="#inputs">文本链接</a></Button>
          </div></div>
          <div className="specimen-row flex flex-col gap-5 py-7 sm:flex-row sm:items-center"><span className="w-24 shrink-0 text-caption text-muted-foreground">尺寸</span><div className="flex flex-wrap items-center gap-4">
            <Button size="sm" variant="secondary" onClick={() => setFeedback("小尺寸 · 36px")}>小尺寸</Button>
            <Button variant="secondary" onClick={() => setFeedback("标准尺寸 · 44px")}>标准尺寸</Button>
            <Button size="lg" variant="secondary" onClick={() => setFeedback("大尺寸 · 48px")}>大尺寸</Button>
            <Button variant="outline" size="icon" aria-label="添加演示项目" onClick={() => setFeedback("已添加演示项目")}><Plus /></Button>
          </div></div>
          <div className="specimen-row flex flex-col gap-5 py-7 sm:flex-row sm:items-center"><span className="w-24 shrink-0 text-caption text-muted-foreground">状态</span><div className="flex flex-wrap items-center gap-4"><Button disabled>不可用</Button><Button variant="secondary" loading>加载中</Button><span className="text-caption text-muted-foreground">键盘 Tab 可查看聚焦状态</span></div></div>
          <div className="border-t border-border py-4 text-caption text-muted-foreground" aria-live="polite">{feedback || "点击按钮，体验交互反馈"}</div>
        </div>
      </Section>

      <Section id="inputs" title="输入框" english="Input" description="安静的默认状态，清晰的聚焦与错误反馈。">
        <div className="surface grid gap-x-10 gap-y-7 p-6 sm:grid-cols-2 sm:p-8">
          <div className="space-y-2.5"><Label htmlFor="sample-name">Token 名称</Label><Input id="sample-name" placeholder="例如：我的开发环境" value={tokenName} onChange={(e) => setTokenName(e.target.value)} /><p className="text-caption text-muted-foreground">一个便于识别的名称。</p></div>
          <div className="space-y-2.5"><Label htmlFor="sample-search">搜索</Label><div className="relative"><Search className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-muted-foreground" aria-hidden="true" /><Input id="sample-search" className="pl-10" placeholder="搜索模型或 Token" value={search} onChange={(e) => setSearch(e.target.value)} /></div><p className="text-caption text-muted-foreground">{search ? `当前输入：${search}` : "支持图标前缀。"}</p></div>
          <div className="space-y-2.5"><Label htmlFor="sample-token">密钥样式</Label><div className="relative"><Input id="sample-token" type={showToken ? "text" : "password"} className="pr-12 font-mono" value="tok_demo_not_a_real_key" readOnly aria-describedby="sample-token-help" /><button type="button" aria-label={showToken ? "隐藏示例文本" : "显示示例文本"} aria-pressed={showToken} onClick={() => setShowToken(!showToken)} className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-250 hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div><p id="sample-token-help" className="text-caption text-muted-foreground">仅用于展示，不是真实密钥。</p></div>
          <div className="space-y-2.5"><Label htmlFor="sample-error">错误状态</Label><Input id="sample-error" defaultValue="" placeholder="Token 名称不能为空" aria-invalid="true" aria-describedby="sample-error-help" /><p id="sample-error-help" className="flex items-center gap-1.5 text-caption text-destructive"><Info className="size-3.5" aria-hidden="true" />请输入 Token 名称。</p></div>
          <div className="space-y-2.5 sm:col-span-2"><Label htmlFor="sample-disabled" className="text-muted-foreground">不可编辑</Label><Input id="sample-disabled" disabled value="此字段由系统管理" className="sm:max-w-[calc(50%-1.25rem)]" /></div>
        </div>
      </Section>
    </>
  );
}
