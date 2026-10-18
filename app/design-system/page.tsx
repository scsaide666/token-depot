import type { Metadata } from "next";
import { DesignSystem } from "@/components/design-system";

export const metadata: Metadata = { title: "设计系统" };

export default function DesignSystemPage() {
  return <DesignSystem />;
}
