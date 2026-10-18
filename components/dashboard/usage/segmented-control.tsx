"use client";

import { RadioGroup } from "radix-ui";

export function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <RadioGroup.Root aria-label={label} value={value} onValueChange={(next) => {
      const option = options.find((option) => option.value === next);
      if (option) onChange(option.value);
    }} loop orientation="horizontal" className="inline-flex w-fit shrink-0 gap-0.5 rounded-md border border-border bg-secondary p-1">
      {options.map((option) => (
        <RadioGroup.Item key={option.value} value={option.value} className="min-h-9 min-w-14 rounded-sm border border-transparent px-3 text-xs text-muted-foreground ui-pressable outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card data-[state=checked]:border-primary/20 data-[state=checked]:bg-card data-[state=checked]:text-link">
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
