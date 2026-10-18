// A bounded request lifetime, including response-body reads. Uses AbortController
// without requiring the newer AbortSignal.any/timeout browser methods.
export function requestSignal(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => { clearTimeout(timer); controller.abort(); };
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  return {
    signal: controller.signal,
    get timedOut() { return timedOut; },
    dispose() { clearTimeout(timer); parent?.removeEventListener("abort", cancel); },
  };
}
