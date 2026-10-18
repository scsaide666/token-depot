"use client";
import { DataError } from "@/components/dashboard/analytics/data-states";
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DataError onRetry={retry} />;
}
