// Per-component GET coordination. Coalesce only identical in-flight reads;
// never retain responses or use this for writes, credentials or SSE requests.
export function latestReadRequests() {
  let active: { key: string; controller: AbortController; promise: Promise<void> } | null = null;
  return {
    run(key: string, execute: (signal: AbortSignal) => Promise<void>, force = false) {
      if (!force && active?.key === key) return active.promise;
      active?.controller.abort();
      const current = { key, controller: new AbortController(), promise: Promise.resolve() };
      active = current;
      current.promise = Promise.resolve().then(() => {
        if (!current.controller.signal.aborted) return execute(current.controller.signal);
      }).finally(() => { if (active === current) active = null; });
      return current.promise;
    },
    cancel() { active?.controller.abort(); active = null; },
  };
}
