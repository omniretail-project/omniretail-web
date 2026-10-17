import type { CurrencyCode } from "@/core/types/common.types";

export function formatCurrency(value: number, currency: CurrencyCode = "GTQ") {
  if (currency === "GTQ") return `Q ${value.toFixed(2)}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}
