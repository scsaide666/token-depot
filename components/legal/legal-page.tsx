import Link from "next/link";
import { MarketingShell } from "@/components/home/marketing-shell";
import { legalDocuments, legalRevision, type LegalPath } from "@/lib/legal-content";
import { siteContact } from "@/lib/server/site-contact";

export function LegalPage({ path }: { path: LegalPath }) {
  const document = legalDocuments[path], contact = siteContact();
  return <MarketingShell contentId="legal-content" language="zh-CN">
    <main id="legal-content" tabIndex={-1} className="px-5 pb-20 outline-none sm:px-8 sm:pb-24">
      <article className="mx-auto max-w-[760px]">
        <header className="pt-14 pb-9 sm:pt-20 sm:pb-12">
          <p className="text-xs tracking-wide text-muted-foreground">Token Depot · 法律与联系</p>
          <h1 className="mt-4 text-[36px] leading-tight font-semibold tracking-[-0.04em] sm:text-[44px]">{document.title}</h1>
          <p className="mt-5 max-w-[620px] text-base leading-8 text-muted-foreground">{document.description}</p>
          <p className="mt-5 text-xs text-muted-foreground">更新：{legalRevision} · 上线审阅稿</p>
          <p className="mt-6 border-l-2 border-border pl-4 text-[13px] leading-7 text-muted-foreground">正式运营资料和上线审核尚未完成。本稿说明当前服务状态，不能作为已取得资质、已开通支付或已完成合规审查的证明。</p>
        </header>
        <nav aria-label="当前页面目录" className="flex flex-wrap gap-x-5 gap-y-3 border-y border-border/70 py-5 text-[13px] text-muted-foreground">
          {document.sections.map(section => <a key={section.id} href={`#${section.id}`} className="transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{section.title}</a>)}
        </nav>
        {document.sections.map(section => <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-24 border-b border-border/70 py-8 sm:py-10">
          <h2 id={`${section.id}-title`} className="text-xl leading-snug font-semibold tracking-[-0.025em]">{section.title}</h2>
          <div className="mt-4 space-y-4 text-[15px] leading-8 text-muted-foreground">
            {section.paragraphs.map(text => <p key={text}>{text}</p>)}
            {section.items && <ul className="space-y-3 pl-5 marker:text-muted-foreground/60 list-disc">{section.items.map(text => <li key={text}>{text}</li>)}</ul>}
          </div>
        </section>)}
        {path === "/contact" && <section aria-labelledby="contact-channels" className="border-b border-border/70 py-8 sm:py-10">
          <h2 id="contact-channels" className="text-xl font-semibold tracking-[-0.025em]">正式联系渠道</h2>
          <dl className="mt-5 space-y-5 text-sm leading-7">
            <div><dt className="text-muted-foreground">运营主体</dt><dd className="mt-1 break-words">{contact.operatorName ?? "待经营者确认，暂未公示。"}</dd></div>
            <div><dt className="text-muted-foreground">联系邮箱</dt><dd className="mt-1 break-words">{contact.email ? <a href={`mailto:${contact.email}`} className="text-primary hover:underline">{contact.email}</a> : "待经营者确认，当前没有可受理消息的公开邮箱。"}</dd></div>
          </dl>
        </section>}
        {path === "/privacy" && <p className="mt-6 text-[13px] leading-7 text-muted-foreground">上游政策：<a href="https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html" className="text-primary hover:underline" rel="noreferrer" target="_blank">DeepSeek 隐私政策</a>。</p>}
        <nav aria-label="协议与联系" className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-[13px] text-muted-foreground">
          {Object.values(legalDocuments).map(item => <Link key={item.path} href={item.path} aria-current={path === item.path ? "page" : undefined} className="transition-colors hover:text-foreground aria-[current=page]:text-foreground">{item.title}</Link>)}
        </nav>
      </article>
    </main>
  </MarketingShell>;
}
