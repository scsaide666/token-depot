import { Brand } from "@/components/brand";
import { BrandMark } from "@/components/brand-mark";
import { ApiRequestFlow, ProviderMark } from "@/components/brand-primitives";
import { ThemeSwitch } from "@/components/theme-switch";
import { Section } from "./section";

export function BrandFoundation() {
  return <Section id="brand" title="品牌" english="Token Depot identity" description="同一个标识，一套视觉语言。从网站到开发者控制台。">
    <div className="surface p-6 sm:p-8">
      <div className="aihub-brand-specimens">
        <div><Brand /><p>Navbar · 28px 标识<br />8px 间距 · 18px 字标</p></div>
        <div><Brand variant="sidebar" /><p>Sidebar · 24px 标识<br />8px 间距 · 16px 字标</p></div>
        <div><BrandMark size={32} /><p>Favicon · 同一几何标识<br />保持原色与方形比例</p></div>
      </div>
      <div className="mt-8 grid gap-8 border-t border-border pt-6 sm:grid-cols-2">
        <div><p className="text-sm font-medium">API request flow</p><ApiRequestFlow /><p className="text-xs leading-relaxed text-muted-foreground">结构示意，非实时流量或服务健康状态。</p></div>
        <div><p className="text-sm font-medium">Provider marks</p><div className="mt-6 flex flex-wrap gap-4">{["OpenAI", "Anthropic", "Google", "DeepSeek"].map(provider => <div key={provider} className="flex items-center gap-2"><ProviderMark provider={provider} /><span className="text-xs text-muted-foreground">{provider}</span></div>)}</div><p className="mt-5 text-xs leading-relaxed text-muted-foreground">统一字母标识；此处仅展示样式，不代表模型已上线。</p></div>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-5 border-t border-border pt-6"><div><p className="text-sm font-medium">Light / Dark / System</p><p className="mt-1 text-xs text-muted-foreground">记住主动选择；System 跟随设备设置。</p></div><ThemeSwitch /></div>
    </div>
  </Section>;
}
