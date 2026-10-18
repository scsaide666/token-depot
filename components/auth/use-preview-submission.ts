"use client";

import { useEffect, useRef, useState } from "react";

export function usePreviewSubmission() {
  const [status, setStatus] = useState<"idle" | "loading" | "complete">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setStatus("idle");
  }

  function submit() {
    reset();
    setStatus("loading");
    // Local preview only: no credentials are sent or persisted.
    timer.current = setTimeout(() => {
      timer.current = null;
      setStatus("complete");
    }, 1000);
  }

  return { status, submit, reset };
}
