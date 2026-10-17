import type { PickingItem } from "@/core/entities";
import {
  InventoryReservationStatus, InventoryTransferStatus, PackingStatus,
  PickingIncidentStatus, PickingItemStatus, PickingStatus, UserStatus, UserType,
} from "@/core/enums";
import type {
  AssignPickingOrderInput, CompleteTransferPickingOrderInput, UpdatePickingItemInput,
} from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { createPackingInDatabase } from "@/infrastructure/mock/repositories/MockPackingRepository";
import { planPickedAllocations } from "@/infrastructure/mock/repositories/pickingSelectionMutations";

interface Dependencies {
  id(prefix: string): string;
  now(): string;
}

function context(db: MockDatabase, scope: { tenantId: string; branchId: string; pickingOrderId: string }) {
  const pickingOrder = db.pickingOrders.find((item) => item.id === scope.pickingOrderId &&
    item.tenantId === scope.tenantId && item.branchId === scope.branchId &&
    item.sourceType === "transfer");
  const transfer = db.inventoryTransfers.find((item) => item.id === pickingOrder?.sourceId &&
    item.tenantId === scope.tenantId && item.sourceBranchId === scope.branchId);
  if (!pickingOrder || !transfer || pickingOrder.orderId !== undefined) {
    throw new Error("Transfer Picking is not in authorized scope");
  }
  return { pickingOrder, transfer };
}

function assertActor(db: MockDatabase, tenantId: string, actorUserId: string) {
  if (!db.users.some((user) => user.id === actorUserId && user.tenantId === tenantId &&
    user.status === UserStatus.active && user.type === UserType.employee)) {
    throw new Error("Transfer Picking actor is not active in tenant");
  }
}

export function assignTransferPickingInDatabase(
  db: MockDatabase, input: AssignPickingOrderInput, dependencies: Dependencies,
) {
  const { pickingOrder, transfer } = context(db, input);
  assertActor(db, input.tenantId, input.actorUserId);
  if (transfer.status !== InventoryTransferStatus.preparing ||
    [PickingStatus.completed, PickingStatus.cancelled].includes(pickingOrder.status)) {
    throw new Error("Transfer is not eligible for Picking");
  }
  if (pickingOrder.assignedUserId === input.actorUserId) {
    return { pickingOrder, idempotent: true, changed: false };
  }
  if (pickingOrder.assignedUserId) throw new Error("Transfer Picking is assigned to another actor");
  pickingOrder.assignedUserId = input.actorUserId;
  const hasProgress = db.pickingItems.some((item) => item.pickingOrderId === pickingOrder.id &&
    item.pickedQuantity > 0);
  pickingOrder.status = hasProgress ? PickingStatus.in_progress : PickingStatus.assigned;
  pickingOrder.updatedAt = dependencies.now();
  return { pickingOrder, idempotent: false, changed: true };
}

export function updateTransferPickingItemInDatabase(
  db: MockDatabase, input: UpdatePickingItemInput, dependencies: Dependencies,
): PickingItem {
  const { pickingOrder, transfer } = context(db, input);
  assertActor(db, input.tenantId, input.performedByUserId);
  if (transfer.status !== InventoryTransferStatus.preparing ||
    pickingOrder.assignedUserId !== input.performedByUserId ||
    [PickingStatus.completed, PickingStatus.cancelled].includes(pickingOrder.status)) {
    throw new Error("Transfer Picking cannot be updated by this actor");
  }
  const item = db.pickingItems.find((entry) => entry.id === input.pickingItemId &&
    entry.pickingOrderId === pickingOrder.id);
  const transferItem = db.inventoryTransferItems.find((entry) => entry.id === item?.orderItemId &&
    entry.transferId === transfer.id && entry.productId === item?.productId);
  if (!item || !transferItem) throw new Error("Transfer Picking line not found");
  const reservation = db.inventoryReservations.find((entry) => entry.tenantId === input.tenantId &&
    entry.branchId === input.branchId && entry.sourceType === "transfer" &&
    entry.sourceId === transfer.id && entry.orderItemId === transferItem.id &&
    entry.productId === item.productId);
  const product = db.products.find((entry) => entry.id === item.productId &&
    entry.tenantId === input.tenantId);
  if (!product || !reservation || reservation.status !== InventoryReservationStatus.active ||
    reservation.allocations.some((allocation) => allocation.consumedQuantity !== 0)) {
    throw new Error("Transfer Picking reservation is not active");
  }
  if (input.locationId !== undefined && input.locationId !== item.locationId) {
    throw new Error("Transfer Picking cannot change reserved location");
  }
  if (input.pickedQuantity === undefined) {
    if (input.serialNumbers !== undefined) throw new Error("Serial selection needs a quantity operation");
    if (input.lotId !== undefined && !item.pickedAllocations?.some((entry) => entry.lotId === input.lotId)) {
      throw new Error("Transfer Picking lot differs from selected allocation");
    }
    return item;
  }
  const operationId = input.operationId.trim();
  if (!operationId) throw new Error("Transfer Picking operationId is required");
  const normalizedSerials = input.serialNumbers?.map((serial) => serial.trim()).sort();
  const fingerprint = JSON.stringify({ itemId: item.id, quantity: input.pickedQuantity,
    serials: normalizedSerials ?? null, lotId: input.lotId ?? null,
    locationId: input.locationId ?? null, status: input.status ?? null,
    actor: input.performedByUserId });
  const retry = db.pickingItemUpdateOperations.find((entry) =>
    entry.tenantId === input.tenantId && entry.operationId === operationId);
  if (retry) {
    if (retry.pickingItemId !== item.id || retry.fingerprint !== fingerprint) {
      throw new Error("Transfer Picking operation conflict");
    }
    return retry.resultItem;
  }
  const target = input.pickedQuantity;
  if (!Number.isFinite(target) || target < item.pickedQuantity || target > item.requestedQuantity) {
    throw new Error("Transfer Picking quantity is invalid");
  }
  const delta = target - item.pickedQuantity;
  if (delta === 0 && !normalizedSerials) throw new Error("Transfer Picking selection is unchanged");
  if (product.tracking.serial && normalizedSerials?.length !== (delta > 0 ? delta : target)) {
    throw new Error("Transfer Picking serial count does not match quantity");
  }
  const selectedSerials = delta > 0
    ? [...(item.serialNumbers ?? []), ...(normalizedSerials ?? [])]
    : normalizedSerials ?? [];
  const allocations = planPickedAllocations(
    db, item, reservation, product, target, selectedSerials, dependencies.now(),
  );
  if (input.lotId !== undefined && !allocations.some((entry) => entry.lotId === input.lotId)) {
    throw new Error("Transfer Picking lot differs from FEFO allocation");
  }
  item.pickedAllocations = allocations;
  item.pickedQuantity = target;
  item.lotId = product.tracking.lot && allocations.length === 1 ? allocations[0].lotId : undefined;
  item.serialNumbers = product.tracking.serial
    ? allocations.flatMap((entry) => entry.serialNumbers ?? []) : undefined;
  const status = target === item.requestedQuantity ? PickingItemStatus.completed
    : target > 0 ? PickingItemStatus.partial : PickingItemStatus.pending;
  if (input.status && input.status !== status && input.status !== PickingItemStatus.incident) {
    throw new Error("Transfer Picking status conflicts with quantity");
  }
  item.status = input.status === PickingItemStatus.incident ? input.status : status;
  if (delta > 0) {
    pickingOrder.status = PickingStatus.in_progress;
    pickingOrder.startedAt ??= dependencies.now();
    pickingOrder.updatedAt = dependencies.now();
  }
  db.pickingItemUpdateOperations.push({
    id: dependencies.id("picking-item-update-operation"), tenantId: input.tenantId,
    branchId: input.branchId, pickingOrderId: pickingOrder.id, pickingItemId: item.id,
    operationId, fingerprint, resultItem: structuredClone(item), createdAt: dependencies.now(),
  });
  return item;
}

export function completeTransferPickingInDatabase(
  db: MockDatabase, input: CompleteTransferPickingOrderInput, dependencies: Dependencies,
) {
  const { pickingOrder, transfer } = context(db, input);
  assertActor(db, input.tenantId, input.actorUserId);
  const existingPacking = db.packings.find((entry) => entry.sourceType === "transfer" &&
    entry.sourceId === transfer.id && entry.tenantId === input.tenantId &&
    entry.branchId === input.branchId);
  if (pickingOrder.status === PickingStatus.completed) {
    if (!existingPacking) throw new Error("Completed Transfer Picking has no Packing");
    return { pickingOrder, transfer, packing: existingPacking, idempotent: true, changed: false };
  }
  if (transfer.status !== InventoryTransferStatus.preparing ||
    pickingOrder.assignedUserId !== input.actorUserId ||
    ![PickingStatus.assigned, PickingStatus.in_progress].includes(pickingOrder.status) ||
    existingPacking) throw new Error("Transfer Picking cannot complete");
  if (db.pickingIncidents.some((incident) => incident.pickingOrderId === pickingOrder.id &&
    incident.status === PickingIncidentStatus.open)) throw new Error("Transfer Picking has open incidents");
  const lines = db.pickingItems.filter((item) => item.pickingOrderId === pickingOrder.id);
  if (lines.length === 0) throw new Error("Transfer Picking has no lines");
  for (const line of lines) {
    const reservation = db.inventoryReservations.find((entry) =>
      entry.sourceType === "transfer" && entry.sourceId === transfer.id &&
      entry.orderItemId === line.orderItemId && entry.productId === line.productId);
    const product = db.products.find((entry) => entry.id === line.productId &&
      entry.tenantId === transfer.tenantId);
    if (!reservation || !product || reservation.status !== InventoryReservationStatus.active ||
      line.pickedQuantity !== line.requestedQuantity || line.status !== PickingItemStatus.completed ||
      (line.pickedAllocations ?? []).reduce((sum, entry) => sum + entry.quantity, 0) !== line.requestedQuantity ||
      (product.tracking.serial && line.serialNumbers?.length !== line.requestedQuantity)) {
      throw new Error(`Transfer Picking line is incomplete: ${line.id}`);
    }
  }
  const now = dependencies.now();
  pickingOrder.status = PickingStatus.completed;
  pickingOrder.completedAt = now;
  pickingOrder.updatedAt = now;
  const result = createPackingInDatabase(db, {
    tenantId: transfer.tenantId, branchId: transfer.sourceBranchId,
    sourceType: "transfer", sourceId: transfer.id,
    pickingOrderId: pickingOrder.id, actorUserId: input.actorUserId,
  }, dependencies);
  if (!result.created || result.packing.status !== PackingStatus.in_progress) {
    throw new Error("Transfer Packing creation conflict");
  }
  return { pickingOrder, transfer, packing: result.packing, idempotent: false, changed: true };
}
