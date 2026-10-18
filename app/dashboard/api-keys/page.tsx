import type { Metadata } from "next";
import { ApiKeysPage } from "@/components/dashboard/api-keys/api-keys-page";
import { requireUser } from "@/lib/server/session";

export const metadata: Metadata = {
  title: { absolute: "API Keys · Token Depot" },
  description: "Create and manage keys used to access the Token Depot API.",
};

export default async function Page() {
  await requireUser();
  return <ApiKeysPage />;
}
