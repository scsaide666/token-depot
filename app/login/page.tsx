import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { redirectAuthenticated } from "@/lib/server/session";

export const metadata: Metadata = {
  title: { absolute: "Sign in · Token Depot" },
  description: "Sign in to Token Depot to manage your API keys, usage and billing.",
};

export default async function LoginPage() {
  await redirectAuthenticated();
  return (
    <AuthShell title="Sign in to Token Depot" description="Manage your API keys, usage and billing.">
      <AuthForm mode="login" />
    </AuthShell>
  );
}
