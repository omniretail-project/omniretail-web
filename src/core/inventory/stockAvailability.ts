import type { InventoryBalance, StorageLocation } from "@/core/entities";
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

export interface InventoryAllocationPlanInput {
  tenantId: string;
  branchId: string;
  productId: string;
  quantity: number;
  balances: InventoryBalance[];
  locations?: StorageLocation[];
  preferredLocationId?: string | null;
}

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

export function getBranchAvailableQuantity({
  tenantId,
  branchId,
  productId,
  balances,
  locations,
}: Omit<InventoryAllocationPlanInput, "quantity" | "preferredLocationId">) {
  return getValidBranchBalances({ tenantId, branchId, productId, balances, locations }).reduce(
    (total, balance) => total + getAvailableQuantity(balance),
    0,
  );
}

export function planInventoryAllocation({
  tenantId,
  branchId,
  productId,
  quantity,
  balances,
  locations,
  preferredLocationId,
}: InventoryAllocationPlanInput): InventoryAllocation[] {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("La cantidad a asignar debe ser mayor a cero.");
  }

  let remaining = quantity;
  const allocations: InventoryAllocation[] = [];
  const sortedBalances = sortBalancesForAllocation(
    getValidBranchBalances({ tenantId, branchId, productId, balances, locations }),
    preferredLocationId,
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
    throw new InsufficientInventoryAvailabilityError(productId);
  }

  return allocations;
}

function getValidBranchBalances({
  tenantId,
  branchId,
  productId,
  balances,
  locations,
}: Omit<InventoryAllocationPlanInput, "quantity" | "preferredLocationId">) {
  return balances.filter((balance) => {
    if (
      balance.tenantId !== tenantId ||
      balance.branchId !== branchId ||
      balance.productId !== productId
    ) {
      return false;
    }
    if (!balance.locationId || !locations) return true;
    return locations.some(
      (location) =>
        location.id === balance.locationId &&
        location.tenantId === tenantId &&
        location.branchId === branchId &&
        location.status === LocationStatus.active,
    );
  });
}

function sortBalancesForAllocation(
  balances: InventoryBalance[],
  preferredLocationId?: string | null,
) {
  return [...balances].sort((left, right) => {
    const leftPreferred = left.locationId === preferredLocationId ? 0 : 1;
    const rightPreferred = right.locationId === preferredLocationId ? 0 : 1;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
    return getBalanceSortKey(left).localeCompare(getBalanceSortKey(right));
  });
}

function getBalanceSortKey(balance: InventoryBalance) {
  return `${balance.locationId ?? ""}:${balance.id}`;
}
