import "server-only";
import type { Metadata, MetadataRoute } from "next";
import { isIP } from "node:net";
import { applicationOrigin } from "@/lib/security/origin";

export const NO_INDEX: Metadata["robots"] = {
  index: false, follow: false, nocache: true,
  googleBot: { index: false, follow: false, noimageindex: true },
};
export const publicPaths = ["/", "/models", "/pricing", "/docs", "/terms", "/privacy", "/refund-policy", "/acceptable-use", "/contact"] as const;
const privatePrefixes = ["/dashboard", "/admin", "/api", "/v1", "/playground", "/login", "/register", "/design-system"];

export function privatePath(path: string) {
  return privatePrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}
export function siteConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const origin = applicationOrigin("http://127.0.0.1:3000", env);
  const url = new URL(origin);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // Only explicitly approved domain-based public sites may be indexed. Literal
  // IPs and special-use/local names stay blocked even when the flag is set.
  const publicHost = host.includes(".") && !isIP(host.replace(/^\[|\]$/g, "")) &&
    !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host);
  const indexable = env.SEO_INDEXING_ENABLED === "true" && url.protocol === "https:" &&
    publicHost;
  return { origin, indexable };
}
export function publicMetadata(path: typeof publicPaths[number], title: string, description: string, env: NodeJS.ProcessEnv = process.env): Metadata {
  const { origin, indexable } = siteConfiguration(env);
  const url = new URL(path, origin).href;
  const image = { url: new URL("/social/token-depot.png", origin).href, width: 1200, height: 630, alt: "Token Depot — One API. Every AI Model." };
  return {
    title: { absolute: title }, description, alternates: { canonical: url },
    robots: indexable ? { index: true, follow: true } : NO_INDEX,
    openGraph: { type: "website", siteName: "Token Depot", title, description, url, locale: "zh_CN", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
export function siteMap(env: NodeJS.ProcessEnv = process.env): MetadataRoute.Sitemap {
  const { origin, indexable } = siteConfiguration(env);
  // Do not publish development/staging URLs or invent last-modified timestamps.
  return indexable ? publicPaths.map(path => ({ url: new URL(path, origin).href })) : [];
}
export function robotRules(env: NodeJS.ProcessEnv = process.env): MetadataRoute.Robots {
  const { origin, indexable } = siteConfiguration(env);
  return indexable ? { rules: { userAgent: "*", allow: "/", disallow: privatePrefixes.flatMap(path => [path, `${path}/`]) }, sitemap: new URL("/sitemap.xml", origin).href } :
    { rules: { userAgent: "*", disallow: "/" } };
}
