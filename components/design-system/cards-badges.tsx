import { Box, Check, CirclePause, KeyRound, LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "./section";

export function CardsAndBadges({ onOpenModal }: { onOpenModal: () => void }) {
  return (
    <>
      <Section id="cards" title="卡片" english="Card" description="精细边框与统一间距，让信息分组保持清晰。">
        <div className="grid gap-5 sm:grid-cols-2">
          <Card className="interactive-card"><CardHeader><div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-secondary"><KeyRound className="size-5" strokeWidth={1.6} aria-hidden="true" /></div><CardTitle>你的第一个 Token</CardTitle><CardDescription className="mt-2 leading-relaxed">为不同的项目创建独立访问凭证，<br className="hidden lg:block" />让每一次调用清晰可控。</CardDescription></CardHeader><CardFooter className="pt-4"><Button variant="outline" onClick={onOpenModal}><KeyRound aria-hidden="true" />创建示例 Token</Button></CardFooter></Card>
          <Card ><CardHeader><div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-secondary"><Box className="size-5" strokeWidth={1.6} aria-hidden="true" /></div><CardTitle>为开发而设计</CardTitle><CardDescription className="mt-2 leading-relaxed">一致的组件与交互，<br className="hidden lg:block" />构建更专注的开发体验。</CardDescription></CardHeader><CardContent className="pt-4"><div className="flex flex-wrap gap-2"><Badge variant="secondary">TypeScript</Badge><Badge variant="secondary">可组合</Badge><Badge variant="secondary">双主题</Badge></div></CardContent></Card>
        </div>
      </Section>
      <Section id="badges" title="标签" english="Badge" description="简短、明确。只在需要时传达状态。">
        <div className="surface flex flex-wrap items-center gap-x-8 gap-y-6 px-7 py-8">
          <div className="space-y-3"><Badge>默认标签</Badge><p className="preview-label">Default</p></div>
          <div className="space-y-3"><Badge variant="secondary">开发环境</Badge><p className="preview-label">Secondary</p></div>
          <div className="space-y-3"><Badge variant="outline">只读</Badge><p className="preview-label">Outline</p></div>
          <div className="space-y-3"><Badge variant="active"><Check className="size-3" />已启用</Badge><p className="preview-label">Active</p></div>
          <div className="space-y-3"><Badge variant="secondary"><CirclePause className="size-3" />已暂停</Badge><p className="preview-label">Paused</p></div>
          <div className="space-y-3"><Badge variant="outline"><LockKeyhole className="size-3" />已撤销</Badge><p className="preview-label">Revoked</p></div>
        </div>
      </Section>
    </>
  );
}
