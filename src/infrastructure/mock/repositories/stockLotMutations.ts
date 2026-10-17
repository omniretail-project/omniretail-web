import type { InventoryBalance, StockLot } from "@/core/entities";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";

export interface StockLotAllocation {
  lot: StockLot;
  quantity: number;
}

/**
 * Expiration is a commercial UTC calendar date. A lot remains sellable throughout
 * the indicated date and expires on the following date.
 */
export function isStockLotEligible(
  lot: Pick<StockLot, "quantity" | "expirationDate">,
  expirationTracked: boolean,
  asOf: string,
): boolean {
  if (lot.quantity <= 0) return false;
  if (!expirationTracked || !lot.expirationDate) return true;
  return getCalendarDate(lot.expirationDate) >= getCalendarDate(asOf);
}

interface StockLotScope {
  tenantId: string;
  branchId: string;
  productId: string;
  locationId?: string;
  expirationTracked: boolean;
  at: string;
}

export function getEligibleLotQuantity(db: MockDatabase, scope: StockLotScope): number {
  return getEligibleStockLots(db, scope).reduce((total, lot) => total + lot.quantity, 0);
}

export function planStockLotConsumption(
  db: MockDatabase,
  scope: StockLotScope,
  quantity: number,
): StockLotAllocation[] {
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("Lot consumption quantity must be positive");
  let remaining = quantity;
  const allocations: StockLotAllocation[] = [];
  for (const lot of getEligibleStockLots(db, scope)) {
    if (remaining <= 0) break;
    const consumed = Math.min(lot.quantity, remaining);
    allocations.push({ lot, quantity: consumed });
    remaining -= consumed;
  }
  if (remaining > 0) throw new Error(`Insufficient eligible lot stock for ${scope.productId}`);
  return allocations;
}

export function consumePlannedStockLots(allocations: StockLotAllocation[]): void {
  allocations.forEach(({ lot, quantity }) => {
    if (quantity <= 0 || lot.quantity < quantity)
      throw new Error(`Invalid StockLot consumption: ${lot.id}`);
  });
  allocations.forEach(({ lot, quantity }) => {
    lot.quantity -= quantity;
  });
}

export function getLotAwareBalances(
  db: MockDatabase,
  scope: Omit<StockLotScope, "locationId">,
): InventoryBalance[] {
  return db.inventoryBalances.map((balance) => {
    if (
      balance.tenantId !== scope.tenantId ||
      balance.branchId !== scope.branchId ||
      balance.productId !== scope.productId
    )
      return balance;
    const eligible = getEligibleLotQuantity(db, { ...scope, locationId: balance.locationId });
    // Reservations are balance/location based; effective physical capacity cannot exceed sellable lots.
    return { ...balance, quantity: Math.min(balance.quantity, eligible) };
  });
}

export function getEligibleStockLots(db: MockDatabase, scope: StockLotScope): StockLot[] {
  return db.stockLots
    .filter((lot) => {
      if (
        lot.tenantId !== scope.tenantId ||
        lot.branchId !== scope.branchId ||
        lot.productId !== scope.productId ||
        (lot.locationId ?? null) !== (scope.locationId ?? null) ||
        !isStockLotEligible(lot, scope.expirationTracked, scope.at)
      )
        return false;
      return true;
    })
    .sort((left, right) => {
      if (scope.expirationTracked) {
        const expiry = (left.expirationDate ?? "9999-12-31").localeCompare(
          right.expirationDate ?? "9999-12-31",
        );
        if (expiry !== 0) return expiry;
      }
      const number = left.lotNumber.localeCompare(right.lotNumber);
      return number !== 0 ? number : left.id.localeCompare(right.id);
    });
}

function getCalendarDate(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid commercial expiration date: ${value}`);
  }
  return date;
}
