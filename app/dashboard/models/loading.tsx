import { ConsolePageHeader, ConsoleTableSkeleton } from "@/components/dashboard/console-primitives";
export default function Loading() { return <div className="console-page console-loading"><ConsolePageHeader title="Models" description="Explore available AI models and compare pricing." /><ConsoleTableSkeleton label="Loading model catalog" /></div>; }
