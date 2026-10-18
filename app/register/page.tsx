import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { redirectAuthenticated } from "@/lib/server/session";

export const metadata: Metadata = {
  title: { absolute: "Create an account · Token Depot" },
  description: "Create your Token Depot account and start building with one API.",
};

export default async function RegisterPage() {
  await redirectAuthenticated();
  return (
    <AuthShell title="Create your Token Depot account" description="One account for every model. Start building with Token Depot.">
      <AuthForm mode="register" />
    </AuthShell>
  );
}
