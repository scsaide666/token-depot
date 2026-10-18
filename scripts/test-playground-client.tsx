import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageContent } from "../components/playground/message-content";
import { PlaygroundError, readPlaygroundStream } from "../lib/playground-stream";
import { completedContext } from "../lib/playground-conversation";

async function main() {
  const html = renderToStaticMarkup(<MessageContent content={'# Safe\n\n<script>alert(1)</script>\n\n![remote](https://evil.example/track)\n\n[xss](javascript:alert(1))\n\n[link](https://example.com)\n\n```javascript\nconst answer = 42;\n```'} />);
  assert(!html.includes("<script") && !html.includes("<img") && !html.includes('href="javascript:'));
  assert(html.includes('rel="noopener noreferrer"') && html.includes("hljs-keyword") && html.includes("<h1>Safe</h1>"));
  console.log("PASS Generated Markdown skips HTML/images/unsafe links and highlights code.");
  const encoder = new TextEncoder(), data = encoder.encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  let offset = 0, text = "";
  await readPlaygroundStream(new Response(new ReadableStream({ pull(controller) { if (offset >= data.length) { controller.close(); return; } controller.enqueue(data.slice(offset, offset + 1)); offset++; } }), { headers: { "Content-Type": "text/event-stream" } }), new AbortController().signal, delta => { text += delta; });
  assert.equal(text, "你好"); console.log("PASS Browser SSE parser handles UTF-8 and delimiters split across single-byte chunks.");
  await assert.rejects(() => readPlaygroundStream(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } }), new AbortController().signal, () => {}), (error: unknown) => error instanceof PlaygroundError && error.code === "streaming_interrupted");
  console.log("PASS Incomplete SSE cannot report successful completion.");
  await assert.rejects(() => readPlaygroundStream(new Response('data: {"error":{"message":"Usage unavailable","code":"usage_missing"}}\n\n', { headers: { "Content-Type": "text/event-stream" } }), new AbortController().signal, () => {}), (error: unknown) => error instanceof PlaygroundError && error.code === "usage_missing");
  console.log("PASS Stream error envelopes retain the real error code.");
  let refusal = "";
  await readPlaygroundStream(new Response('data: {"choices":[{"delta":{"refusal":"Cannot help with that."}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } }), new AbortController().signal, part => { refusal += part; });
  assert.equal(refusal, "Cannot help with that."); console.log("PASS Streamed refusals remain visible to the user.");
  const context = completedContext([{ id: "1", role: "user", content: "oversized rejected prompt" }, { id: "2", role: "assistant", content: "", state: "failed" }, { id: "3", role: "user", content: "accepted" }, { id: "4", role: "assistant", content: "reply", state: "complete" }]);
  assert.deepEqual(context, [{ role: "user", content: "accepted" }, { role: "assistant", content: "reply" }]); console.log("PASS Failed and stopped turns cannot poison later conversation context.");
}
void main().catch(() => { console.error("Playground client verification failed."); process.exitCode = 1; });
