import { filterModels, type ModelProviderFilter, type PublicModel } from "@/lib/model-types";

export const priceFilters = [{ value: "all", label: "All prices" }, { value: "low", label: "Input ≤ ¥1 / 1M" }, { value: "standard", label: "Input ≤ ¥5 / 1M" }, { value: "higher", label: "Input > ¥5 / 1M" }] as const;
export const capabilityFilters = [{ value: "all", label: "All capabilities" }, { value: "chat", label: "Chat completions" }, { value: "long-context", label: "Long context (128K+)" }] as const;
export type PriceFilter = (typeof priceFilters)[number]["value"];
export type CapabilityFilter = (typeof capabilityFilters)[number]["value"];

// Compare published Decimal strings directly; a tiny price above a boundary must not round down.
export function priceAtMost(value: string, wholeLimit: string) {
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole);
  const limit = BigInt(wholeLimit);
  return amount < limit || (amount === limit && !/[1-9]/.test(fraction));
}
export function catalogCapabilities(model: PublicModel) {
  return model.contextWindow >= 128000 ? ["Chat", "Long context"] : ["Chat"];
}
export function filterConsoleModels(catalog: PublicModel[], search: string, provider: ModelProviderFilter, price: PriceFilter, capability: CapabilityFilter) {
  return filterModels(catalog, search, provider).filter(model =>
    (price === "all" || (price === "low" ? priceAtMost(model.inputPricePerMillion, "1") : price === "standard" ? priceAtMost(model.inputPricePerMillion, "5") : !priceAtMost(model.inputPricePerMillion, "5"))) &&
    (capability !== "long-context" || model.contextWindow >= 128000));
}
