import type { Metadata } from "next";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { getAccountSessions, requireUser } from "@/lib/server/session";
import { publicCatalog } from "@/lib/server/models";
import { publicApiBaseUrl } from "@/lib/server/public-api-url";

export const metadata: Metadata = {
  title: { absolute: "Settings · Token Depot" },
  description: "Manage your account and workspace preferences.",
};

export default async function Page() {
  await requireUser();
  const [sessions, models] = await Promise.all([getAccountSessions(), publicCatalog()]);
  return <SettingsPage sessions={sessions} apiBaseUrl={publicApiBaseUrl()} {...models} />;
}
