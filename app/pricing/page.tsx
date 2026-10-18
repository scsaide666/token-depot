import { publicCatalog } from "@/lib/server/models";
import { publicMetadata } from "@/lib/seo";
import Link from "next/link";
import { MarketingShell } from "@/components/home/marketing-shell";
import { PricingTable } from "@/components/pricing/pricing-table";
import { PricingFAQ } from "@/components/pricing/pricing-faq";
import { Button } from "@/components/ui/button";
import { billingSteps } from "@/lib/pricing-content";

export const metadata = publicMetadata("/pricing", "Token 按量定价 · Token Depot", "比较各模型每百万输入和输出 Token 的人民币销售价格，了解余额预留、实际用量结算及计费规则。");

export default async function PricingPage() {
  const data = await publicCatalog();
  return <MarketingShell currentPage="pricing">
    <main id="pricing-content" tabIndex={-1} className="px-5 outline-none sm:px-8">
      <section aria-labelledby="pricing-title" className="mx-auto max-w-[860px] pt-14 pb-14 text-center sm:pt-16 sm:pb-16">
        <h1 id="pricing-title" className="ui-marketing-title"><span className="block">Simple pricing.</span><span className="block">Pay for what you use.</span></h1>
        <p className="mx-auto mt-5 max-w-[560px] text-base leading-[1.65] text-muted-foreground sm:text-lg">No subscriptions. No minimum spend. Add balance and pay only for API usage.</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3"><Button asChild><Link href="/register">Get Started</Link></Button><Button asChild variant="outline" className="bg-card"><Link href="/models">View Models</Link></Button></div>
      </section>
      <PricingTable {...data} />
      <section aria-labelledby="billing-works-heading" className="mx-auto max-w-[var(--content-public)] pt-16 pb-16 sm:pt-20 sm:pb-20">
        <h2 id="billing-works-heading" className="text-2xl leading-snug font-semibold tracking-[-0.035em] sm:text-[28px]">How billing works</h2>
        <ol className="mt-9 grid gap-8 md:grid-cols-3 md:gap-10">
          {billingSteps.map((step, index) => <li key={step.title} className="border-t border-border/70 pt-6">
            <span aria-hidden="true" className="text-sm text-muted-foreground tabular-nums">{index + 1}</span>
            <h3 className="mt-4 max-w-[290px] text-lg leading-snug tracking-[-0.025em]">{step.title}</h3>
            <p className="mt-3 max-w-[290px] text-sm leading-[1.8] text-muted-foreground">{step.description}</p>
          </li>)}
        </ol>
      </section>
      <section aria-labelledby="pricing-faq-heading" className="mx-auto max-w-[760px] pb-20 sm:pb-24">
        <h2 id="pricing-faq-heading" className="text-center text-2xl leading-snug font-semibold tracking-[-0.035em] sm:text-[28px]">Frequently asked questions</h2>
        <PricingFAQ />
      </section>
      <section aria-labelledby="pricing-cta-heading" className="mx-auto max-w-[var(--content-public)] border-t border-border/70 pt-16 pb-20 text-center sm:pt-20 sm:pb-24">
        <h2 id="pricing-cta-heading" className="text-[32px] leading-tight font-semibold tracking-[-0.04em] sm:text-[40px]">Start with one API key.</h2>
        <Button asChild className="mt-7"><Link href="/register">Get Started</Link></Button>
      </section>
    </main>
  </MarketingShell>;
}
