"use client";
import { DataError } from "@/components/dashboard/analytics/data-states";
export default function Error({ retry }: { retry: () => void }) { return <DataError message="We couldn’t load administration data. Please try again." onRetry={retry} />; }
