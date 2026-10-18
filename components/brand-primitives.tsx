import { Braces, Layers2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

/* Letter marks identify providers without imitating their trademarks. */
export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  return <span aria-hidden="true" className={cn("aihub-provider-mark", className)}>{provider.slice(0, 1).toUpperCase()}</span>;
}

/* An architectural illustration, never a live health or traffic indicator. */
export function ApiRequestFlow() {
  return <ol className="aihub-api-flow" aria-label="API request flow: your client, Token Depot, selected model">
    <li><span className="aihub-flow-node"><Braces size={18} strokeWidth={1.5} aria-hidden="true" /></span><code>Client</code><small>Your application</small></li>
    <li><span className="aihub-flow-node"><BrandMark size={28} /></span><code>Token Depot</code><small>One API endpoint</small></li>
    <li><span className="aihub-flow-node"><Layers2 size={18} strokeWidth={1.5} aria-hidden="true" /></span><code>Model</code><small>Your selected model</small></li>
  </ol>;
}

export function TokenUsageBreakdown({ input, output }: { input: number | null; output: number | null }) {
  // Unknown upstream usage stays unknown; this graphic never estimates tokens.
  if (input === null || output === null || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return null;
  const total = input + output;
  if (!Number.isSafeInteger(total) || total === 0) return null;
  return <div className="aihub-token-breakdown" aria-label={`Confirmed usage: ${input.toLocaleString("en-US")} input tokens and ${output.toLocaleString("en-US")} output tokens`}>
    <div className="aihub-token-track" aria-hidden="true"><span style={{ width: `${input / total * 100}%` }} /><span style={{ width: `${output / total * 100}%` }} /></div>
    <div className="aihub-token-legend" aria-hidden="true"><span><i />Input</span><span><i />Output</span></div>
  </div>;
}
