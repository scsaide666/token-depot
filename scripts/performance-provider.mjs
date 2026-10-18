import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

// Local deterministic fixture only. This process never contacts a real provider.
const port = Number(process.env.PERFORMANCE_PROVIDER_PORT ?? 3191);
const secret = process.env.PERFORMANCE_PROVIDER_KEY;
if (!secret) throw new Error("A fixture key is required.");
const usage = { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 };
const server = createServer(async (request, response) => {
  if (request.url === "/health") return void response.end("ok");
  if (request.headers.authorization !== `Bearer ${secret}`) return void response.writeHead(401).end();
  try {
    const buffers = [];
    for await (const chunk of request) buffers.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    if (!String(body.model).startsWith("performance-")) return void response.writeHead(400).end();
    await delay(10);
    if (!body.stream) return void response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      choices: [{ index: 0, message: { role: "assistant", content: "fixture OK" }, finish_reason: "stop" }], usage,
    }));
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const frame = (data) => response.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
    frame({ choices: [{ index: 0, delta: { role: "assistant", content: "fixture " }, finish_reason: null }] });
    await delay(10);
    frame({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] });
    await delay(10);
    frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    frame({ choices: [], usage });
    frame("[DONE]");
    response.end();
  } catch { if (!response.destroyed) response.writeHead(500).end(); }
});
server.listen(port, "127.0.0.1", () => console.log("Performance fixture ready."));
