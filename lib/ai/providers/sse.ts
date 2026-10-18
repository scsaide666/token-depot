import "server-only";
import { streamError } from "../types";

export type SseEvent = { event: string; data: string };
// A bounded parser, rather than split-on-chunk: UTF-8, lines and events can all
// cross network chunk boundaries. EOF never synthesizes an unfinished event.
export async function* readSse(response: Response, signal: AbortSignal): AsyncGenerator<SseEvent> {
  if (!response.body) throw streamError();
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", data: string[] = [], event = "message", bytes = 0, eventSize = 0, events = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw streamError();
      const part = await reader.read();
      if (signal.aborted) throw streamError();
      if (part.done) { buffer += decoder.decode(); if (buffer || data.length) throw streamError(); break; }
      bytes += part.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw streamError();
      buffer += decoder.decode(part.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, boundary).replace(/\r$/, ""); buffer = buffer.slice(boundary + 1);
        if (!line) {
          if (data.length) { if (++events > 100000) throw streamError(); yield { event, data: data.join("\n") }; }
          data = []; event = "message"; eventSize = 0; continue;
        }
        eventSize += line.length;
        if (eventSize > 64 * 1024) throw streamError();
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":"), name = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (name === "data") data.push(value); else if (name === "event") event = value;
      }
      if (buffer.length > 64 * 1024) throw streamError();
    }
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Retain only a suffix that might become a secret on the next delta. Normal
// text can flow immediately; partial keys cannot escape across event boundaries.
// Short coincidences such as an ordinary word matching a key prefix remain
// readable; eight matching characters are masked if the full key is uncertain.
const protectedPrefixLength = 8;
export class StreamRedactor {
  private pending = "";
  constructor(private readonly secret: string) {}
  push(text: string) {
    if (!this.secret) return text;
    const value = this.pending + text;
    this.pending = "";
    let output = "", cursor = 0;
    while (cursor < value.length) {
      const start = value.indexOf(this.secret[0], cursor);
      if (start < 0) { output += value.slice(cursor); break; }
      output += value.slice(cursor, start);
      let matched = 0;
      while (matched < this.secret.length && start + matched < value.length && value[start + matched] === this.secret[matched]) matched++;
      if (matched === this.secret.length || matched >= protectedPrefixLength && start + matched < value.length) {
        output += "[REDACTED]";
        cursor = start + matched;
      } else if (start + matched === value.length) {
        this.pending = value.slice(start);
        break;
      } else {
        output += value[start];
        cursor = start + 1;
      }
    }
    return output;
  }
  // A stream can end after emitting all but the last character of a secret.
  // Mask a held high-risk prefix, while preserving ordinary short suffixes.
  flush() { const value = this.pending.length >= protectedPrefixLength ? "[REDACTED]" : this.pending; this.pending = ""; return value; }
}
