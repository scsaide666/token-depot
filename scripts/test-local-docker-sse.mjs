import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:https";
import { performance } from "node:perf_hooks";

// Deliberately fixed to the loopback-only local Caddy profile. The local CA
// is not trusted by the host; this probe does not verify public certificates.
const pathFor = (path) => `/__docker_test_sse${path}`;
const options = (path) => ({
  hostname: "127.0.0.1", port: 8443, servername: "localhost", method: "GET",
  path: pathFor(path), rejectUnauthorized: false,
  headers: { Host: "localhost:8443", Accept: "text/event-stream" },
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readState(id) {
  return new Promise((resolve, reject) => {
    const call = request(options(`/state?id=${id}`), (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; if (body.length > 4096) call.destroy(new Error("Oversized probe state")); });
      response.on("end", () => {
        try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    call.setTimeout(3000, () => call.destroy(new Error("Probe state timeout")));
    call.on("error", reject);
    call.end();
  });
}

function completedStream(id) {
  return new Promise((resolve, reject) => {
    let body = "", firstAt;
    const call = request(options(`/events?mode=complete&id=${id}`), (response) => {
      try {
        assert.equal(response.statusCode, 200);
        assert.match(String(response.headers["content-type"]), /^text\/event-stream/);
        assert(response.socket?.encrypted, "Local Caddy did not use TLS");
      } catch (error) { call.destroy(error); return; }
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4096) { call.destroy(new Error("Oversized probe stream")); return; }
        if (!firstAt && body.includes('data: {"part":"first"}\n\n')) firstAt = performance.now();
      });
      response.on("end", () => {
        try {
          assert(firstAt, "The first SSE event was not forwarded");
          assert(body.includes("data: [DONE]\n\n"), "The SSE stream did not end with [DONE]");
          assert(performance.now() - firstAt >= 500, "Caddy buffered the first SSE event until completion");
          resolve();
        } catch (error) { reject(error); }
      });
    });
    call.setTimeout(5000, () => call.destroy(new Error("SSE completion timeout")));
    call.on("error", reject);
    call.end();
  });
}

function disconnectedStream(id) {
  return new Promise((resolve, reject) => {
    let body = "", received = false;
    const call = request(options(`/events?mode=hold&id=${id}`), (response) => {
      try { assert.equal(response.statusCode, 200); } catch (error) { call.destroy(error); return; }
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4096) { call.destroy(new Error("Oversized probe stream")); return; }
        if (!received && body.includes('data: {"part":"first"}\n\n')) {
          received = true;
          response.destroy();
          resolve();
        }
      });
      response.on("error", (error) => { if (!received) reject(error); });
    });
    call.setTimeout(5000, () => call.destroy(new Error("SSE disconnect setup timeout")));
    call.on("error", (error) => { if (!received) reject(error); });
    call.end();
  });
}

async function main() {
  await completedStream(randomUUID());
  console.log("PASS local HTTPS SSE forwards the first event before completion and preserves [DONE]");

  const id = randomUUID();
  await disconnectedStream(id);
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const state = await readState(id);
    if (state.closed && !state.completed) {
      console.log("PASS client disconnect cancels the Caddy upstream stream");
      return;
    }
    await delay(100);
  }
  throw new Error("The SSE fixture did not observe an upstream close after client disconnect");
}

main().catch((error) => { console.error(`FAIL local Caddy SSE probe: ${error.message}`); process.exitCode = 1; });
