import type { Metadata } from "next";
import { Playground } from "@/components/playground/playground";
import { requireUser } from "@/lib/server/session";
import { playgroundModels } from "@/lib/server/playground";
import type { PlaygroundModel } from "@/lib/playground-types";

export const metadata: Metadata = { title: { absolute: "Playground · Token Depot" }, description: "Explore AI models with real streaming responses and usage statistics.", robots: { index: false, follow: false } };
export default async function Page() {
  const user = await requireUser();
  let models: PlaygroundModel[] = [], loadError = false;
  try { models = await playgroundModels(); } catch { loadError = true; }
  return <Playground models={models} initialBalance={user.wallet.balanceDisplay} loadError={loadError} />;
}
