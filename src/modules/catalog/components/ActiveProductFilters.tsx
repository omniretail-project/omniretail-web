import type { ProductFiltersState } from "@/modules/catalog/types/catalog.types";

export function getActiveProductFiltersCount(filters: ProductFiltersState) {
  return [
    filters.status !== "all",
    filters.productType !== "all",
    filters.categoryId !== "all",
    filters.channels.length > 0,
    filters.promotion !== "all",
  ].filter(Boolean).length;
}
