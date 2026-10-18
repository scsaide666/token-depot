"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ScrollReveal({ children, className, variant = "heading" }: {
  children: ReactNode;
  className?: string;
  variant?: "heading" | "preview";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Leave server-rendered content visible when it is already in view.
    if (element.getBoundingClientRect().top < window.innerHeight - 48) return;
    element.dataset.reveal = "pending";

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      element.dataset.reveal = "visible";
      observer.disconnect();
    }, { threshold: 0.08, rootMargin: "0px 0px -48px 0px" });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} data-reveal-variant={variant} className={cn("home-scroll-reveal", className)}>{children}</div>;
}
