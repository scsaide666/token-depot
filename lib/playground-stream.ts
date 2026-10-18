export class PlaygroundError extends Error {
  constructor(message: string, public readonly code = "request_failed") { super(message); }
}
export async function responseError(response: Response) {
  const body = await response.json().catch(() => null);
  return new PlaygroundError(typeof body?.error === "string" ? body.error : body?.error?.message ?? "The request could not be completed.", body?.error?.code ?? body?.code ?? "request_failed");
}

// Network chunks are not SSE events. Decode UTF-8 incrementally and bound both
// the event buffer and the entire response, including unterminated events.
export async function readPlaygroundStream(response: Response, signal: AbortSignal, onText: (text: string) => void) {
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new PlaygroundError("The server did not return a stream.");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", data: string[] = [], bytes = 0, eventSize = 0, done = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (!done) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) throw new PlaygroundError("The stream ended before completion. Check Usage before sending again.", "streaming_interrupted");
      bytes += part.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new PlaygroundError("The response exceeds the display limit.", "response_too_large");
      buffer += decoder.decode(part.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, boundary).replace(/\r$/, ""); buffer = buffer.slice(boundary + 1);
        if (!line) {
          if (data.length) {
            const value = data.join("\n");
            if (value === "[DONE]") { done = true; break; }
            const frame = JSON.parse(value);
            if (frame.error) throw new PlaygroundError(frame.error.message ?? "The stream was interrupted.", frame.error.code);
            const text = frame.choices?.[0]?.delta?.content;
            if (typeof text === "string") onText(text);
            const refusal = frame.choices?.[0]?.delta?.refusal;
            if (typeof refusal === "string") onText(refusal);
          }
          data = []; eventSize = 0;
        } else {
          eventSize += line.length;
          if (eventSize > 65536) throw new PlaygroundError("The response event is too large.");
          if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (buffer.length > 65536) throw new PlaygroundError("The response event is too large.");
    }
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
