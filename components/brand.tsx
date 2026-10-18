import Link from "next/link";
import { BrandMark } from "./brand-mark";

export function Brand({ name = "Token Depot", variant = "navbar" }: { name?: "Token Depot"; variant?: "navbar" | "sidebar" | "auth" }) {
  return (
    <Link href="/" aria-label="Token Depot home" data-variant={variant} className="aihub-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
      <BrandMark size={variant === "sidebar" ? 28 : variant === "auth" ? 40 : 32} priority={variant === "navbar"} />
      <span className="aihub-brand-wordmark">{name}</span>
    </Link>
  );
}
