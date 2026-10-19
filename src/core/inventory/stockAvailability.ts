import type { InventoryBalance, ProductInventorySettings, StorageLocation } from "@/core/entities";
import { LocationStatus } from "@/core/enums";

export interface InventoryAllocation {
  balanceId: string;
  branchId: string;
  productId: string;
  locationId?: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
}

/**
 * Alcance operativo de un producto en una sucursal. `assignedLocationId` es OBLIGATORIO a
 * proposito (null = sin asignacion): ningun consumidor puede olvidar la politica de ubicacion.
 */
export interface OperationalStockScope {
  tenantId: string;
  branchId: string;
  productId: string;
  balances: InventoryBalance[];
  locations: StorageLocation[];
  assignedLocationId: string | null;
}

export interface InventoryAllocationPlanInput extends OperationalStockScope {
  quantity: number;
}

export type OperationalLocationSelection =
  | { source: "assigned"; locationId: string }
  /** Compatibilidad heredada: solo balances con locationId NULL, nunca ubicaciones alternativas. */
  | { source: "legacy_null" }
  | { source: "none"; reason: "location_unknown" | "location_inactive" };

export class InsufficientInventoryAvailabilityError extends Error {
  constructor(productId: string) {
    super(`Stock disponible insuficiente para ${productId}.`);
    this.name = "InsufficientInventoryAvailabilityError";
  }
}

export function getAvailableQuantity(
  balance: Pick<InventoryBalance, "quantity" | "reservedQuantity">,
) {
  return Math.max(balance.quantity - balance.reservedQuantity, 0);
}

/** Ubicacion operativa asignada (si existe) de un producto en una sucursal. */
export function findAssignedLocationId(
  settings: readonly Pick<
    ProductInventorySettings,
    "tenantId" | "branchId" | "productId" | "defaultLocationId"
  >[],
  scope: Pick<OperationalStockScope, "tenantId" | "branchId" | "productId">,
): string | null {
  return (
    settings.find(
      (item) =>
        item.tenantId === scope.tenantId &&
        item.branchId === scope.branchId &&
        item.productId === scope.productId,
    )?.defaultLocationId ?? null
  );
}

/**
 * Politica unica de seleccion de stock operativo:
 * - con asignacion: SOLO la ubicacion asignada y activa de la sucursal; si falta o esta
 *   inactiva el producto no puede operar (no hay fallback a otras ubicaciones ni a NULL);
 * - sin asignacion: unicamente balances heredados con locationId NULL.
 */
export function resolveOperationalLocation({
  tenantId,
  branchId,
  locations,
  assignedLocationId,
}: Pick<
  OperationalStockScope,
  "tenantId" | "branchId" | "locations" | "assignedLocationId"
>): OperationalLocationSelection {
  if (!assignedLocationId) return { source: "legacy_null" };
  const location = locations.find(
    (item) =>
      item.id === assignedLocationId && item.tenantId === tenantId && item.branchId === branchId,
  );
  if (!location) return { source: "none", reason: "location_unknown" };
  if (location.status !== LocationStatus.active) {
    return { source: "none", reason: "location_inactive" };
  }
  return { source: "assigned", locationId: location.id };
}

/** Balances que una venta, reserva, consumo o traslado puede tocar para este producto. */
export function selectOperationalBalances(scope: OperationalStockScope): InventoryBalance[] {
  const selection = resolveOperationalLocation(scope);
  if (selection.source === "none") return [];
  return scope.balances.filter((balance) => {
    if (
      balance.tenantId !== scope.tenantId ||
      balance.branchId !== scope.branchId ||
      balance.productId !== scope.productId
    ) {
      return false;
    }
    return selection.source === "assigned"
      ? balance.locationId === selection.locationId
      : !balance.locationId;
  });
}

export function getBranchAvailableQuantity(scope: OperationalStockScope) {
  return selectOperationalBalances(scope).reduce(
    (total, balance) => total + getAvailableQuantity(balance),
    0,
  );
}

export function planInventoryAllocation({
  quantity,
  ...scope
}: InventoryAllocationPlanInput): InventoryAllocation[] {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("La cantidad a asignar debe ser mayor a cero.");
  }

  let remaining = quantity;
  const allocations: InventoryAllocation[] = [];
  const sortedBalances = [...selectOperationalBalances(scope)].sort((left, right) =>
    getBalanceSortKey(left).localeCompare(getBalanceSortKey(right)),
  );

  for (const balance of sortedBalances) {
    const available = getAvailableQuantity(balance);
    if (available <= 0) continue;

    const assignedQuantity = Math.min(available, remaining);
    const quantityAfter = balance.quantity - assignedQuantity;
    if (quantityAfter < balance.reservedQuantity) continue;

    allocations.push({
      balanceId: balance.id,
      branchId: balance.branchId,
      productId: balance.productId,
      locationId: balance.locationId,
      quantity: assignedQuantity,
      quantityBefore: balance.quantity,
      quantityAfter,
    });
    remaining -= assignedQuantity;
    if (remaining <= 0) break;
  }

  if (remaining > 0) {
    throw new InsufficientInventoryAvailabilityError(scope.productId);
  }

  return allocations;
}

function getBalanceSortKey(balance: InventoryBalance) {
  return `${balance.locationId ?? ""}:${balance.id}`;
}
