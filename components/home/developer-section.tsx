import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { CodeCopyButton } from "./code-copy-button";
import { HighlightedCode } from "./highlighted-code";
import { ApiRequestFlow } from "@/components/brand-primitives";

export function DeveloperSection({ apiBaseUrl }: { apiBaseUrl: string }) {
  const javascriptExample = `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  apiKey: process.env.AIHUB_API_KEY,\n  maxRetries: 0,\n  timeout: 180_000,\n  baseURL: ${JSON.stringify(apiBaseUrl)}\n});\n\n// Your existing SDK. A new endpoint.`;
  return (
    <section id="developers" className="v-section v-frame v-developer-section" aria-labelledby="developers-heading">
      <div className="v-developer-copy"><p className="v-kicker">Made for your stack</p><h2 id="developers-heading">Less integration.<br />More building.</h2><p>Use the OpenAI SDK you already know. Change the base URL and connect your Token Depot API key.</p>
        <ul>{["Python, JavaScript, or curl", "Standard streaming responses", "Usage and cost in your console"].map(benefit => <li key={benefit}><Check size={14} aria-hidden="true" />{benefit}</li>)}</ul>
        <ApiRequestFlow />
        <Link href="/docs" className="v-text-link">Read the documentation <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>
      <figure className="v-integration-code" aria-label="JavaScript SDK setup">
        <figcaption className="v-window-bar"><span className="v-terminal-label">client.ts</span><CodeCopyButton code={javascriptExample} label="Copy SDK setup" showLabel dark /></figcaption>
        <pre className="v-code" tabIndex={0} aria-label="JavaScript SDK setup. Scroll horizontally to read the full code."><HighlightedCode code={javascriptExample} /></pre>
        <div className="v-sdk-note"><span>OpenAI-compatible</span><code>npm install openai</code></div>
      </figure>
    </section>
  );
}

