import { publicCatalog } from "@/lib/server/models";
import type { Metadata } from "next";
import { ModelsPage } from "@/components/dashboard/models/models-page";
import { requireUser } from "@/lib/server/session";

export const metadata: Metadata = {
  title: { absolute: "Models · Token Depot" },
  description: "Explore available AI models and compare pricing.",
};

export default async function Page() {
  await requireUser();
  return <ModelsPage {...await publicCatalog()} />;
}
