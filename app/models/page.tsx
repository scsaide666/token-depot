import { publicCatalog } from "@/lib/server/models";
import { publicMetadata } from "@/lib/seo";
import { MarketingShell } from "@/components/home/marketing-shell";
import { ModelExplorer } from "@/components/models/model-explorer";

export const metadata = publicMetadata("/models", "AI 模型目录 · Token Depot", "查看 Token Depot 当前可用模型，比较能力、上下文窗口和人民币输入与输出 Token 价格。");

export default async function ModelsPage() {
  const data = await publicCatalog();
  return <MarketingShell currentPage="models">
    <main id="models-content" tabIndex={-1} className="px-5 pb-20 outline-none sm:px-8 sm:pb-24">
      <section aria-labelledby="models-title" className="mx-auto max-w-[860px] pt-14 pb-12 text-center sm:pt-16 sm:pb-14">
        <h1 id="models-title" className="ui-marketing-title">Explore models.</h1>
        <p className="mx-auto mt-5 max-w-[620px] text-base leading-[1.65] text-muted-foreground sm:text-lg">Compare context windows and pricing across leading AI providers.</p>
      </section>
      <ModelExplorer {...data} />
    </main>
  </MarketingShell>;
}
