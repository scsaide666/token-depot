import { publicMetadata } from "@/lib/seo";
import { DocsArticle } from "@/components/docs/docs-article";
import { DocsShell } from "@/components/docs/docs-shell";

export const metadata = publicMetadata("/docs", "API 文档与接入指南 · Token Depot", "Token Depot API 认证、模型调用、流式响应、错误码、限流和计费说明，提供 Python、JavaScript 与 curl 示例。");

export default function Page() { return <DocsShell><DocsArticle /></DocsShell>; }
