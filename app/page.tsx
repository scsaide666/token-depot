import { publicCatalog } from "@/lib/server/models";
import { publicMetadata, siteConfiguration } from "@/lib/seo";
import { HomeTop } from "@/components/home/home-top";

export const metadata = publicMetadata("/", "Token Depot · One API. Every AI Model.", "通过统一的 OpenAI 兼容 API 调用可用 AI 模型，管理 API Key、Token 用量及人民币按量计费。");

export default async function Home() {
  const data = await publicCatalog();
  return <HomeTop {...data} apiBaseUrl={`${siteConfiguration().origin}/v1`} />;
}
