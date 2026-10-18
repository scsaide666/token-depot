import { createServer } from "node:http";

// This fixture runs only in the local-https Compose profile. It has no keys,
// database connection or public port and never calls an AI provider.
const states = new Map();
const validId = (value) => /^[a-f0-9-]{36}$/.test(value ?? "");

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:3188");
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  if (url.pathname === "/healthz") return json(response, 200, { ok: true });

  const id = url.searchParams.get("id");
  if (!validId(id)) return json(response, 400, { error: "Invalid probe ID" });
  if (url.pathname === "/state") {
    const state = states.get(id);
    return json(response, state ? 200 : 404, state ?? { error: "Unknown probe ID" });
  }
  if (url.pathname !== "/events" || !["complete", "hold"].includes(url.searchParams.get("mode"))) {
    return json(response, 404, { error: "Not found" });
  }
  if (states.has(id)) return json(response, 409, { error: "Probe ID already used" });

  const state = { closed: false, completed: false };
  states.set(id, state);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  response.flushHeaders();
  response.write('data: {"part":"first"}\n\n');

  const interval = url.searchParams.get("mode") === "hold"
    ? setInterval(() => response.write(": keepalive\n\n"), 250)
    : undefined;
  const finish = setTimeout(() => {
    if (!response.destroyed) {
      state.completed = true;
      response.end("data: [DONE]\n\n");
    }
  }, interval ? 8000 : 1200);
  response.on("close", () => {
    state.closed = true;
    if (interval) clearInterval(interval);
    clearTimeout(finish);
    setTimeout(() => states.delete(id), 30000).unref();
  });
}).listen(3188, "0.0.0.0");
