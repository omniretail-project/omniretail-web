import type { InventoryReservation, PickingItem, Product } from "@/core/entities";
import { InventoryTransferStatus, OrderStatus, PickingStatus, SerialStatus } from "@/core/enums";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { getAvailableSerials } from "@/infrastructure/mock/repositories/serialNumberMutations";
import { getEligibleStockLots } from "@/infrastructure/mock/repositories/stockLotMutations";

type PickedAllocation = NonNullable<PickingItem["pickedAllocations"]>[number];

function activePicks(db: MockDatabase): PickingItem[] {
  return db.pickingItems.filter((item) => {
    const picking = db.pickingOrders.find((entry) => entry.id === item.pickingOrderId);
    if (picking?.sourceType === "transfer") {
      const transfer = db.inventoryTransfers.find((entry) => entry.id === picking.sourceId &&
        entry.tenantId === picking.tenantId && entry.sourceBranchId === picking.branchId);
      return !!transfer && picking.status !== PickingStatus.cancelled &&
        transfer.status === InventoryTransferStatus.preparing;
    }
    const order = picking && db.orders.find((entry) => entry.id === picking.orderId);
    return picking && order && picking.status !== PickingStatus.cancelled &&
      ![OrderStatus.cancelled, OrderStatus.dispatched, OrderStatus.delivered].includes(order.status);
  });
}

export function getClaimedPickingSerialNumbers(
  db: MockDatabase,
  scope: { tenantId: string; branchId: string; productId: string },
  excludeItemId?: string,
): Set<string> {
  return new Set(activePicks(db).filter((item) => {
    const picking = db.pickingOrders.find((entry) => entry.id === item.pickingOrderId);
    return item.id !== excludeItemId && item.productId === scope.productId && picking?.tenantId === scope.tenantId &&
      picking.branchId === scope.branchId;
  }).flatMap((item) => item.serialNumbers ?? []));
}

export function assertPickedSerialsAvailable(
  db: MockDatabase,
  item: PickingItem,
  reservation: InventoryReservation,
  product: Product,
  serialNumbers: readonly string[],
): void {
  if (new Set(serialNumbers).size !== serialNumbers.length) {
    throw new Error("Duplicate serial number in PickingItem");
  }
  const claimed = getClaimedPickingSerialNumbers(db, reservation, item.id);
  serialNumbers.forEach((number) => {
    const serial = db.serialNumbers.find(
      (entry) => entry.tenantId === reservation.tenantId && entry.serialNumber === number,
    );
    if (!serial || serial.productId !== product.id || serial.branchId !== reservation.branchId ||
      serial.status !== SerialStatus.available || claimed.has(number)) {
      throw new Error(`Serial number is not available for Picking: ${number}`);
    }
    if (!reservation.allocations.some((allocation) =>
      (allocation.locationId ?? null) === (serial.locationId ?? null))) {
      throw new Error(`Serial number is outside reserved locations: ${number}`);
    }
  });
}

/** Plans against the reserved balances and FEFO lots without mutating physical inventory. */
export function planPickedAllocations(
  db: MockDatabase,
  item: PickingItem,
  reservation: InventoryReservation,
  product: Product,
  targetQuantity: number,
  serialNumbers: readonly string[],
  at: string,
): PickedAllocation[] {
  if (product.tracking.serial && serialNumbers.length !== targetQuantity) {
    throw new Error("Picking serial count must match picked quantity");
  }
  if (!product.tracking.serial && serialNumbers.length > 0) {
    throw new Error("Non-serial product cannot select serial numbers");
  }
  if (product.tracking.serial) {
    assertPickedSerialsAvailable(db, item, reservation, product, serialNumbers);
  }
  const { existing, planned } = planPickingAllocationCapacity(
    db, item, reservation, product, targetQuantity, at,
  );
  if (product.tracking.serial) {
    const serials = db.serialNumbers.filter((entry) => entry.tenantId === reservation.tenantId &&
      serialNumbers.includes(entry.serialNumber));
    const used = new Set<string>();
    const preserveExisting = targetQuantity > item.pickedQuantity ||
      (item.serialNumbers?.length === serialNumbers.length &&
        item.serialNumbers.every((number) => serialNumbers.includes(number)));
    planned.forEach((allocation, index) => {
      if (preserveExisting && index < existing.length) {
        const prior = existing[index].serialNumbers ?? [];
        if (prior.length !== allocation.quantity || prior.some((number) => !serialNumbers.includes(number))) {
          throw new Error("Persisted Picking serial selection is inconsistent");
        }
        allocation.serialNumbers = [...prior];
        prior.forEach((number) => used.add(number));
        return;
      }
      const matching = serials.filter((serial) =>
        (serial.locationId ?? null) === (allocation.locationId ?? null) &&
        (!product.tracking.lot || serial.lotId === allocation.lotId));
      const unassigned = matching.filter((serial) => !used.has(serial.serialNumber));
      if (unassigned.length < allocation.quantity) {
        throw new Error("Picked serials do not match reserved location/FEFO lot allocation");
      }
      const selected = unassigned.slice(0, allocation.quantity);
      allocation.serialNumbers = selected.map((serial) => serial.serialNumber);
      selected.forEach((serial) => used.add(serial.serialNumber));
    });
    if (used.size !== serialNumbers.length) {
      throw new Error("Picked serials include an unallocated serial number");
    }
  }
  return planned;
}

/** Same reservation/FEFO capacity plan used by mutation and serial-option projection. */
export function planPickingAllocationCapacity(
  db: MockDatabase,
  item: PickingItem,
  reservation: InventoryReservation,
  product: Product,
  targetQuantity: number,
  at: string,
  allowPartial = false,
): { existing: PickedAllocation[]; planned: PickedAllocation[] } {
  const existing = item.pickedAllocations ?? [];
  if (existing.reduce((total, entry) => total + entry.quantity, 0) !== item.pickedQuantity) {
    throw new Error(`Persisted Picking selections are incomplete: ${item.id}`);
  }
  const allPicks = activePicks(db);
  const claimedSerials = product.tracking.lot && product.tracking.serial
    ? getClaimedPickingSerialNumbers(db, reservation)
    : undefined;
  let remaining = targetQuantity - item.pickedQuantity;
  const planned: PickedAllocation[] = existing.map((entry) => ({ ...entry,
    serialNumbers: entry.serialNumbers ? [...entry.serialNumbers] : undefined }));
  for (const allocation of reservation.allocations) {
    if (remaining <= 0) break;
    const alreadyPicked = existing.filter((entry) => entry.balanceId === allocation.balanceId)
      .reduce((total, entry) => total + entry.quantity, 0);
    const quantity = Math.min(allocation.reservedQuantity - alreadyPicked, remaining);
    if (quantity <= 0) continue;
    if (!product.tracking.lot) {
      planned.push({ balanceId: allocation.balanceId, locationId: allocation.locationId,
        quantity });
      remaining -= quantity;
      continue;
    }
    const lots = getEligibleStockLots(db, {
      tenantId: reservation.tenantId, branchId: reservation.branchId,
      productId: reservation.productId, locationId: allocation.locationId,
      expirationTracked: product.tracking.expiration, at,
    });
    let locationRemaining = quantity;
    for (const lot of lots) {
      if (locationRemaining <= 0) break;
      const claimed = allPicks.reduce((total, picked) => total +
        (picked.pickedAllocations ?? []).filter((entry) => entry.lotId === lot.id)
          .reduce((sum, entry) => sum + entry.quantity, 0), 0);
      const unclaimedLotQuantity = Math.max(0, lot.quantity - claimed);
      const available = claimedSerials
        ? Math.min(unclaimedLotQuantity, getAvailableSerials(db, {
            tenantId: reservation.tenantId, branchId: reservation.branchId,
            productId: reservation.productId, locationId: allocation.locationId, lotId: lot.id,
          }).filter((serial) => !claimedSerials.has(serial.serialNumber)).length)
        : unclaimedLotQuantity;
      const lotQuantity = Math.min(available, locationRemaining);
      if (lotQuantity <= 0) continue;
      planned.push({ balanceId: allocation.balanceId, locationId: allocation.locationId,
        lotId: lot.id, quantity: lotQuantity });
      locationRemaining -= lotQuantity;
      remaining -= lotQuantity;
    }
    if (locationRemaining > 0 && !allowPartial) throw new Error("Insufficient eligible lot stock for Picking");
  }
  if (remaining > 0 && !allowPartial) throw new Error("Picked quantity exceeds reserved allocations");
  return { existing, planned };
}
