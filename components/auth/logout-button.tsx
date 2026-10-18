"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export async function signOut(all = false) {
  const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all }) });
  if (!response.ok) throw new Error("Unable to sign out. Please try again.");
  window.location.replace("/login");
}

export function LogoutButton({ className, children = "Sign out" }: { className?: string; children?: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function logout() { setLoading(true); setError(""); try { await signOut(); } catch { setError("Unable to sign out. Try again."); setLoading(false); } }
  return <div><Button loading={loading} variant="ghost" type="button" onClick={logout} disabled={loading} className={className}>{loading ? "Signing out…" : children}</Button>{error && <p role="alert" className="mt-2 px-3 text-xs text-destructive">{error}</p>}</div>;
}
