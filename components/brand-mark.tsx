import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandMark({ size = 28, className, priority = false }: { size?: number; className?: string; priority?: boolean }) {
  return <Image src="/brand/token-depot-mark-td.png" alt="" aria-hidden="true" width={size} height={size} priority={priority}
    className={cn("aihub-brand-mark", className)} />;
}
