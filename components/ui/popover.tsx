"use client";

import type { ComponentProps } from "react";
import { Popover as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;

export function PopoverContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content data-slot="popover-content" sideOffset={sideOffset} className={cn("ui-floating-surface z-50 rounded-md border border-border bg-card p-4 text-foreground shadow-md outline-none", className)} {...props} /></Primitive.Portal>;
}
