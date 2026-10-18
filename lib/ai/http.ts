import "server-only";

// Bound both advertised and streamed body sizes. Never include the body in an error.
export async function readLimitedText(source: Pick<Request, "body" | "headers">, limit: number, signal: AbortSignal): Promise<string> {
  const length = source.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) { void source.body?.cancel().catch(() => {}); throw new Error("body_limit"); }
  if (!source.body) throw new Error("invalid_body");
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let rejectAbort: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { rejectAbort(new Error("body_timeout")); void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await Promise.race([reader.read(), aborted]);
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("body_limit");
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } finally {
    signal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readLimitedJson(source: Request | Response, limit: number, signal: AbortSignal): Promise<unknown> {
  return JSON.parse(await readLimitedText(source, limit, signal));
}
