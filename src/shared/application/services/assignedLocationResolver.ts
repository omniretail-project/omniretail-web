import type { InventoryRepository } from "@/core/repositories";

export type AssignedLocationResolver = (productId: string) => Promise<string | null>;

/**
 * Resuelve (con cache por consulta) la ubicacion operativa asignada de cada producto en UNA
 * sucursal. Es la unica fuente para alimentar `core/inventory/stockAvailability`; ningun
 * consumidor debe inferir la ubicacion a partir de los saldos.
 */
export function createAssignedLocationResolver(
  inventory: Pick<InventoryRepository, "getProductInventorySettings">,
  branchId: string,
): AssignedLocationResolver {
  const cache = new Map<string, Promise<string | null>>();
  return (productId) => {
    const cached = cache.get(productId);
    if (cached) return cached;
    const pending = inventory
      .getProductInventorySettings(productId, branchId)
      .then((settings) => settings?.defaultLocationId ?? null);
    cache.set(productId, pending);
    return pending;
  };
}
