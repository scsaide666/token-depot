"use client";

import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

// Treat all generated content as untrusted. Raw HTML is skipped; remote images
// cannot trigger background requests; links permit only explicit HTTPS/HTTP URLs.
export const MessageContent = memo(function MessageContent({ content }: { content: string }) {
  return <div className="playground-markdown min-w-0"><Markdown skipHtml disallowedElements={["img"]} remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]}
    urlTransform={url => /^https?:\/\//i.test(url) ? url : ""}
    components={{ a: ({ href, children }) => <a href={href || undefined} target="_blank" rel="noopener noreferrer">{children}</a>,
      table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div> }}
  >{content}</Markdown></div>;
});
