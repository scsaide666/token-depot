"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Accordion(props: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn("border-b border-border", className)} {...props} />;
}

function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger data-slot="accordion-trigger" className={cn("group flex min-h-16 flex-1 items-center justify-between gap-6 rounded-[4px] py-5 text-left text-[15px] font-medium outline-none transition-colors duration-[var(--motion-base)] hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background sm:text-base", className)} {...props}>
      {children}<ChevronDown aria-hidden="true" strokeWidth={1.6} className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-base)] group-data-[state=open]:rotate-180" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>;
}

function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content data-slot="accordion-content" className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-[var(--motion-base)]" {...props}>
    <div className={cn("max-w-[680px] pr-8 pb-6 text-sm leading-[1.8] text-muted-foreground", className)}>{children}</div>
  </AccordionPrimitive.Content>;
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
