import { InventoryMovementType, InventoryReservationStatus, SerialStatus } from "@/core/enums";
import type {
  InventoryBalance,
  InventoryMovement,
  InventoryReservation,
  InventoryReservationAllocation,
  InventoryReservationConsumeOperation,
} from "@/core/entities";
import { planInventoryAllocation } from "@/core/inventory/stockAvailability";
import type {
  ConsumeInventoryReservationInput,
  ConsumeInventoryReservationResult,
  ReleaseInventoryReservationInput,
  ReserveOrderItemInput,
} from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  consumePlannedStockLots,
  getLotAwareBalances,
  isStockLotEligible,
  planStockLotConsumption,
} from "@/infrastructure/mock/repositories/stockLotMutations";
import {
  consumePlannedSerials,
  getLotSerialAwareBalances,
  getSerialAwareBalances,
  planLotSerialConsumption,
  planSerialConsumption,
} from "@/infrastructure/mock/repositories/serialNumberMutations";

interface ReservationConsumptionOptions {
  pickedLots?: Array<{ balanceId: string; lotId: string; quantity: number }>;
  movement?: { reason: string; referenceType: string; referenceId: string };
  serialStatus?: SerialStatus;
}

interface InventoryReservationMutationDependencies {
  id(prefix: string): string;
  now(): string;
}

export interface InventoryReservationMutationResult {
  reservation: InventoryReservation;
  changed: boolean;
}

export interface InventoryReservationConsumeMutationResult extends ConsumeInventoryReservationResult {
  changed: boolean;
}

export function reserveOrderItemInDatabase(
  db: MockDatabase,
  input: ReserveOrderItemInput,
  dependencies: InventoryReservationMutationDependencies,
): InventoryReservationMutationResult {
  assertPositiveQuantity(input.quantity, "Reservation quantity");
  assertReservationReferences(input, db);

  const existing = db.inventoryReservations.find(
    (item) =>
      item.tenantId === input.tenantId &&
      item.orderItemId === input.orderItemId &&
      item.productId === input.productId,
  );
  if (existing) {
    assertMatchingReservation(existing, input);
    return { reservation: existing, changed: false };
  }

  const settings = db.productInventorySettings.find(
    (item) =>
      item.tenantId === input.tenantId &&
      item.branchId === input.branchId &&
      item.productId === input.productId,
  );
  const product = db.products.find(
    (item) => item.id === input.productId && item.tenantId === input.tenantId,
  );
  if (!product) throw new Error(`Product not found for tenant: ${input.productId}`);
  const plannedAllocations = planInventoryAllocation({
    tenantId: input.tenantId,
    branchId: input.branchId,
    productId: input.productId,
    quantity: input.quantity,
    balances:
      product.tracking.lot && product.tracking.serial
        ? getLotSerialAwareBalances(db, {
            ...input,
            expirationTracked: product.tracking.expiration,
            at: dependencies.now(),
          })
        : product.tracking.lot
          ? getLotAwareBalances(db, {
              ...input,
              expirationTracked: product.tracking.expiration,
              at: dependencies.now(),
            })
          : product.tracking.serial
            ? getSerialAwareBalances(db, input)
            : db.inventoryBalances,
    locations: db.storageLocations,
    preferredLocationId: settings?.defaultLocationId,
  });
  const now = dependencies.now();
  const allocations: InventoryReservationAllocation[] = plannedAllocations.map((allocation) => ({
    id: dependencies.id("reservation-allocation"),
    balanceId: allocation.balanceId,
    locationId: allocation.locationId,
    reservedQuantity: allocation.quantity,
    consumedQuantity: 0,
  }));
  const reservation: InventoryReservation = {
    id: dependencies.id("inventory-reservation"),
    tenantId: input.tenantId,
    branchId: input.branchId,
    orderId: input.orderId,
    orderItemId: input.orderItemId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    productId: input.productId,
    status: InventoryReservationStatus.active,
    allocations,
    createdAt: now,
    updatedAt: now,
  };

  allocations.forEach((allocation) => {
    const balance = db.inventoryBalances.find((item) => item.id === allocation.balanceId);
    if (!balance) throw new Error(`InventoryBalance not found: ${allocation.balanceId}`);
    balance.reservedQuantity += allocation.reservedQuantity;
    balance.updatedAt = now;
  });
  db.inventoryReservations.push(reservation);
  return { reservation, changed: true };
}

export function releaseInventoryReservationInDatabase(
  db: MockDatabase,
  input: ReleaseInventoryReservationInput,
  dependencies: Pick<InventoryReservationMutationDependencies, "now">,
): InventoryReservationMutationResult {
  assertRequiredText(input.tenantId, "Reservation tenantId");
  assertRequiredText(input.branchId, "Reservation branchId");
  assertRequiredText(input.reservationId, "Reservation id");

  const reservation = findReservationForMutation(input, db);
  if (
    reservation.status === InventoryReservationStatus.released ||
    reservation.status === InventoryReservationStatus.consumed
  ) {
    return { reservation, changed: false };
  }

  const releases = reservation.allocations.map((allocation) => {
    const remaining = getInventoryReservationAllocationRemaining(allocation);
    const balance = findInventoryReservationBalance(reservation, allocation, db);
    if (balance.reservedQuantity < remaining) {
      throw new Error(`Insufficient reserved stock in balance: ${balance.id}`);
    }
    return { balance, remaining };
  });
  if (releases.reduce((total, item) => total + item.remaining, 0) <= 0) {
    throw new Error(`Active reservation has no remaining quantity: ${reservation.id}`);
  }

  const now = dependencies.now();
  releases.forEach(({ balance, remaining }) => {
    balance.reservedQuantity -= remaining;
    balance.updatedAt = now;
  });
  reservation.status = InventoryReservationStatus.released;
  reservation.updatedAt = now;
  return { reservation, changed: true };
}

export function consumeInventoryReservationInDatabase(
  db: MockDatabase,
  input: ConsumeInventoryReservationInput,
  dependencies: InventoryReservationMutationDependencies,
  options: ReservationConsumptionOptions = {},
): InventoryReservationConsumeMutationResult {
  assertConsumeInput(input);
  const fingerprint = getConsumeFingerprint(input);
  const existingOperation = db.inventoryReservationConsumeOperations.find(
    (operation) =>
      operation.tenantId === input.tenantId && operation.operationId === input.operationId,
  );
  if (existingOperation) {
    if (existingOperation.fingerprint !== fingerprint) {
      throw new Error(`Inventory reservation operation conflict: ${input.operationId}`);
    }
    const inventoryMovements = existingOperation.inventoryMovementIds.map((movementId) => {
      const movement = db.inventoryMovements.find((item) => item.id === movementId);
      if (!movement) throw new Error(`InventoryMovement not found: ${movementId}`);
      return movement;
    });
    return {
      reservation: existingOperation.resultReservation,
      inventoryMovements,
      idempotent: true,
      changed: false,
    };
  }

  const reservation = findReservationForMutation(input, db);
  if (reservation.status === InventoryReservationStatus.released) {
    throw new Error(`Released reservation cannot be consumed: ${reservation.id}`);
  }
  if (reservation.status === InventoryReservationStatus.consumed) {
    throw new Error(`Consumed reservation has no remaining quantity: ${reservation.id}`);
  }

  const product = db.products.find(
    (item) => item.id === reservation.productId && item.tenantId === reservation.tenantId,
  );
  if (!product) throw new Error(`Product not found for reservation: ${reservation.id}`);
  const requestedSerialNumbers = input.serialNumbers
    ?.map((serial) => serial.trim())
    .filter(Boolean);
  const totalConsumed = input.allocationsConsumed.reduce((total, item) => total + item.quantity, 0);
  if (
    product.tracking.serial &&
    requestedSerialNumbers?.length &&
    requestedSerialNumbers.length !== totalConsumed
  ) {
    throw new Error("Requested serial numbers must exactly match the consumed quantity");
  }
  const planned = input.allocationsConsumed.map((consumed) => {
    const allocation = reservation.allocations.find(
      (item) => item.balanceId === consumed.balanceId,
    );
    if (!allocation) {
      throw new Error(`Balance does not belong to reservation: ${consumed.balanceId}`);
    }
    const remaining = getInventoryReservationAllocationRemaining(allocation);
    if (consumed.quantity > remaining) {
      throw new Error(`Consumed quantity exceeds reservation allocation: ${consumed.balanceId}`);
    }
    const balance = findInventoryReservationBalance(reservation, allocation, db);
    if (balance.quantity < consumed.quantity) {
      throw new Error(`Insufficient stock in balance: ${balance.id}`);
    }
    if (balance.reservedQuantity < consumed.quantity) {
      throw new Error(`Insufficient reserved stock in balance: ${balance.id}`);
    }
    const selectedLots = options.pickedLots?.filter((item) => item.balanceId === consumed.balanceId);
    if (selectedLots && product.tracking.lot &&
      selectedLots.reduce((total, item) => total + item.quantity, 0) !== consumed.quantity) {
      throw new Error("Picked lot allocations do not match reserved balance quantity");
    }
    const exactLots = selectedLots?.map((selected) => {
      const lot = db.stockLots.find((item) => item.id === selected.lotId &&
        item.tenantId === reservation.tenantId && item.branchId === reservation.branchId &&
        item.productId === reservation.productId &&
        (item.locationId ?? null) === (allocation.locationId ?? null));
      if (!lot || lot.quantity < selected.quantity || selected.quantity <= 0 ||
        !isStockLotEligible(lot, product.tracking.expiration, dependencies.now())) {
        throw new Error(`Picked lot is no longer available: ${selected.lotId}`);
      }
      return { lot, quantity: selected.quantity };
    });
    const lotSerialAllocations =
      product.tracking.lot && product.tracking.serial
        ? exactLots
          ? exactLots.map((lotAllocation) => {
              const selectedSerials = requestedSerialNumbers?.filter((number) =>
                db.serialNumbers.some((serial) => serial.tenantId === reservation.tenantId &&
                  serial.serialNumber === number && serial.lotId === lotAllocation.lot.id));
              if (selectedSerials?.length !== lotAllocation.quantity) {
                throw new Error("Picked serials do not match the selected lot");
              }
              return {
                lotAllocation,
                serialNumbers: planSerialConsumption(db, {
                  tenantId: reservation.tenantId, branchId: reservation.branchId,
                  productId: reservation.productId, locationId: allocation.locationId,
                  lotId: lotAllocation.lot.id,
                }, lotAllocation.quantity, selectedSerials),
              };
            })
          : planLotSerialConsumption(
            db,
            {
              tenantId: reservation.tenantId,
              branchId: reservation.branchId,
              productId: reservation.productId,
              locationId: allocation.locationId,
              expirationTracked: product.tracking.expiration,
              at: dependencies.now(),
            },
            consumed.quantity,
            requestedSerialNumbers,
          )
        : [];
    const lotAllocations =
      product.tracking.lot && !product.tracking.serial
        ? exactLots ?? planStockLotConsumption(
            db,
            {
              tenantId: reservation.tenantId,
              branchId: reservation.branchId,
              productId: reservation.productId,
              locationId: allocation.locationId,
              expirationTracked: product.tracking.expiration,
              at: dependencies.now(),
            },
            consumed.quantity,
          )
        : [];
    const requestedForLocation = requestedSerialNumbers?.filter((serial) =>
      db.serialNumbers.some(
        (item) =>
          item.serialNumber === serial &&
          item.tenantId === reservation.tenantId &&
          item.branchId === reservation.branchId &&
          item.productId === reservation.productId &&
          (item.locationId ?? null) === (allocation.locationId ?? null),
      ),
    );
    if (
      product.tracking.serial &&
      !product.tracking.lot &&
      requestedSerialNumbers?.length &&
      requestedForLocation?.length !== consumed.quantity
    ) {
      throw new Error("Requested serial numbers do not match reservation locations");
    }
    const serialNumbers =
      product.tracking.serial && !product.tracking.lot
        ? planSerialConsumption(
            db,
            {
              tenantId: reservation.tenantId,
              branchId: reservation.branchId,
              productId: reservation.productId,
              locationId: allocation.locationId,
            },
            consumed.quantity,
            requestedForLocation,
          )
        : [];
    return {
      allocation,
      balance,
      quantity: consumed.quantity,
      lotAllocations,
      lotSerialAllocations,
      serialNumbers,
    };
  });
  if (product.tracking.serial && !product.tracking.lot && requestedSerialNumbers?.length) {
    const selected = planned
      .flatMap((item) => item.serialNumbers)
      .map((serial) => serial.serialNumber);
    if (selected.length !== requestedSerialNumbers.length) {
      throw new Error("Requested serial numbers do not match reservation locations");
    }
  }

  const now = dependencies.now();
  const inventoryMovements = planned.flatMap(
    ({ allocation, balance, quantity, lotAllocations, lotSerialAllocations, serialNumbers }) => {
      const quantityBefore = balance.quantity;
      balance.quantity -= quantity;
      balance.reservedQuantity -= quantity;
      balance.updatedAt = now;
      allocation.consumedQuantity += quantity;

      if (lotSerialAllocations.length > 0) {
        consumePlannedStockLots(lotSerialAllocations.map((item) => item.lotAllocation));
        consumePlannedSerials(
          lotSerialAllocations.flatMap((item) => item.serialNumbers),
          now,
          options.serialStatus,
        );
        let movementBefore = quantityBefore;
        return lotSerialAllocations.flatMap(({ lotAllocation, serialNumbers: plannedSerials }) =>
          plannedSerials.map((serial) => {
            const movementAfter = movementBefore - 1;
            const movement = createReservationMovement(
              1,
              movementBefore,
              movementAfter,
              lotAllocation.lot.id,
              serial.id,
            );
            movementBefore = movementAfter;
            db.inventoryMovements.push(movement);
            return movement;
          }),
        );
      }
      if (serialNumbers.length > 0) {
        consumePlannedSerials(serialNumbers, now, options.serialStatus);
        let movementBefore = quantityBefore;
        return serialNumbers.map((serial) => {
          const movementAfter = movementBefore - 1;
          const movement = createReservationMovement(
            1,
            movementBefore,
            movementAfter,
            undefined,
            serial.id,
          );
          movementBefore = movementAfter;
          db.inventoryMovements.push(movement);
          return movement;
        });
      }
      if (lotAllocations.length === 0) {
        const movement = createReservationMovement(quantity, quantityBefore, balance.quantity);
        db.inventoryMovements.push(movement);
        return [movement];
      }
      consumePlannedStockLots(lotAllocations);
      let movementBefore = quantityBefore;
      return lotAllocations.map(({ lot, quantity: lotQuantity }) => {
        const movementAfter = movementBefore - lotQuantity;
        const movement = createReservationMovement(
          lotQuantity,
          movementBefore,
          movementAfter,
          lot.id,
        );
        movementBefore = movementAfter;
        db.inventoryMovements.push(movement);
        return movement;
      });

      function createReservationMovement(
        movementQuantity: number,
        movementQuantityBefore: number,
        movementQuantityAfter: number,
        lotId?: string,
        serialNumberId?: string,
      ): InventoryMovement {
        return {
          id: dependencies.id("movement"),
          tenantId: reservation.tenantId,
          branchId: reservation.branchId,
          productId: reservation.productId,
          lotId,
          serialNumberId,
          type: InventoryMovementType.out,
          reason: options.movement?.reason ?? `Consumo de reserva ${reservation.id}`,
          quantity: movementQuantity,
          quantityBefore: movementQuantityBefore,
          quantityAfter: movementQuantityAfter,
          fromLocationId: allocation.locationId,
          referenceType: options.movement?.referenceType ?? "inventoryReservation",
          referenceId: options.movement?.referenceId ?? reservation.id,
          performedByUserId: input.performedByUserId,
          createdAt: now,
        };
      }
    },
  );

  reservation.status = reservation.allocations.some(
    (allocation) => getInventoryReservationAllocationRemaining(allocation) > 0,
  )
    ? InventoryReservationStatus.active
    : InventoryReservationStatus.consumed;
  reservation.updatedAt = now;

  const operation: InventoryReservationConsumeOperation = {
    id: dependencies.id("reservation-consume-operation"),
    tenantId: input.tenantId,
    branchId: input.branchId,
    reservationId: input.reservationId,
    operationId: input.operationId,
    fingerprint,
    allocationsConsumed: input.allocationsConsumed.map((item) => ({ ...item })),
    inventoryMovementIds: inventoryMovements.map((movement) => movement.id),
    resultReservation: structuredClone(reservation),
    performedByUserId: input.performedByUserId,
    createdAt: now,
  };
  db.inventoryReservationConsumeOperations.push(operation);

  return { reservation, inventoryMovements, idempotent: false, changed: true };
}

export function findReservationForMutation(
  input: ReleaseInventoryReservationInput,
  db: MockDatabase,
): InventoryReservation {
  const reservation = db.inventoryReservations.find(
    (item) => item.id === input.reservationId && item.tenantId === input.tenantId,
  );
  if (!reservation) {
    throw new Error(`InventoryReservation not found for tenant: ${input.reservationId}`);
  }
  if (reservation.branchId !== input.branchId) {
    throw new Error(`InventoryReservation branch conflict: ${input.reservationId}`);
  }
  return reservation;
}

export function findInventoryReservationBalance(
  reservation: InventoryReservation,
  allocation: InventoryReservationAllocation,
  db: MockDatabase,
): InventoryBalance {
  const balance = db.inventoryBalances.find((item) => item.id === allocation.balanceId);
  if (!balance) throw new Error(`InventoryBalance not found: ${allocation.balanceId}`);
  if (
    balance.tenantId !== reservation.tenantId ||
    balance.branchId !== reservation.branchId ||
    balance.productId !== reservation.productId ||
    (balance.locationId ?? null) !== (allocation.locationId ?? null)
  ) {
    throw new Error(`InventoryBalance context conflict: ${allocation.balanceId}`);
  }
  return balance;
}

export function getInventoryReservationAllocationRemaining(
  allocation: InventoryReservationAllocation,
): number {
  if (
    !Number.isFinite(allocation.reservedQuantity) ||
    !Number.isFinite(allocation.consumedQuantity) ||
    allocation.reservedQuantity < 0 ||
    allocation.consumedQuantity < 0 ||
    allocation.consumedQuantity > allocation.reservedQuantity
  ) {
    throw new Error(`Invalid inventory reservation allocation: ${allocation.id}`);
  }
  return allocation.reservedQuantity - allocation.consumedQuantity;
}

function assertReservationReferences(input: ReserveOrderItemInput, db: MockDatabase): void {
  assertRequiredText(input.tenantId, "Reservation tenantId");
  assertRequiredText(input.branchId, "Reservation branchId");
  assertRequiredText(input.orderItemId, "Reservation orderItemId");
  assertRequiredText(input.productId, "Reservation productId");

  const tenant = db.tenants.find((item) => item.id === input.tenantId);
  if (!tenant) throw new Error(`Tenant not found: ${input.tenantId}`);
  const branch = db.branches.find((item) => item.id === input.branchId);
  if (!branch || branch.tenantId !== input.tenantId) {
    throw new Error(`Branch not found for tenant: ${input.branchId}`);
  }
  const product = db.products.find((item) => item.id === input.productId);
  if (!product || product.tenantId !== input.tenantId) {
    throw new Error(`Product not found for tenant: ${input.productId}`);
  }
  if (input.sourceType === "transfer") {
    assertRequiredText(input.sourceId, "Transfer reservation sourceId");
    if (input.orderId !== undefined) throw new Error("Transfer reservation cannot reference an Order");
    const transfer = db.inventoryTransfers.find((item) =>
      item.id === input.sourceId && item.tenantId === input.tenantId &&
      item.sourceBranchId === input.branchId);
    const transferItem = db.inventoryTransferItems.find((item) =>
      item.id === input.orderItemId && item.transferId === transfer?.id &&
      item.productId === input.productId);
    if (!transferItem || input.quantity > transferItem.requestedQuantity) {
      throw new Error(`Transfer item not found or quantity conflict: ${input.orderItemId}`);
    }
    return;
  }
  assertRequiredText(input.orderId, "Reservation orderId");
  const order = db.orders.find(
    (item) =>
      item.id === input.orderId &&
      item.tenantId === input.tenantId &&
      item.branchId === input.branchId,
  );
  if (!order) throw new Error(`Order not found for tenant/branch: ${input.orderId}`);
  const orderItem = order.items.find(
    (item) => item.id === input.orderItemId && item.orderId === input.orderId,
  );
  if (!orderItem) throw new Error(`OrderItem not found in order: ${input.orderItemId}`);
  const fulfillment = orderItem.fulfillmentComponents?.find(
    (component) => component.productId === input.productId,
  );
  if (orderItem.productId !== input.productId && !fulfillment) {
    throw new Error(`OrderItem product conflict: ${input.orderItemId}`);
  }
  if (input.quantity > (fulfillment?.quantity ?? orderItem.inventoryQuantity ?? orderItem.quantity)) {
    throw new Error(`Reservation quantity exceeds OrderItem quantity: ${input.orderItemId}`);
  }
}

function assertMatchingReservation(
  reservation: InventoryReservation,
  input: ReserveOrderItemInput,
): void {
  const reservedQuantity = reservation.allocations.reduce(
    (total, allocation) => total + allocation.reservedQuantity,
    0,
  );
  if (
    reservation.branchId !== input.branchId ||
    reservation.orderId !== input.orderId ||
    reservation.sourceId !== input.sourceId ||
    (reservation.sourceType ?? "order") !== (input.sourceType ?? "order") ||
    reservation.productId !== input.productId ||
    reservedQuantity !== input.quantity
  ) {
    throw new Error(`Inventory reservation conflict for OrderItem: ${input.orderItemId}`);
  }
}

function assertPositiveQuantity(quantity: number, label: string): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }
}

function assertRequiredText(value: string | undefined, label: string): asserts value is string {
  if (!value?.trim()) throw new Error(`${label} is required`);
}

function assertConsumeInput(input: ConsumeInventoryReservationInput): void {
  assertRequiredText(input.tenantId, "Reservation tenantId");
  assertRequiredText(input.branchId, "Reservation branchId");
  assertRequiredText(input.reservationId, "Reservation id");
  assertRequiredText(input.operationId, "Reservation operationId");
  assertRequiredText(input.performedByUserId, "Reservation performedByUserId");
  if (input.allocationsConsumed.length === 0) {
    throw new Error("Reservation consumption requires at least one allocation");
  }
  const balanceIds = new Set<string>();
  input.allocationsConsumed.forEach((allocation) => {
    assertRequiredText(allocation.balanceId, "Consumed allocation balanceId");
    assertPositiveQuantity(allocation.quantity, "Consumed allocation quantity");
    if (balanceIds.has(allocation.balanceId)) {
      throw new Error(`Duplicate consumed balance: ${allocation.balanceId}`);
    }
    balanceIds.add(allocation.balanceId);
  });
}

function getConsumeFingerprint(input: ConsumeInventoryReservationInput): string {
  return JSON.stringify({
    tenantId: input.tenantId,
    branchId: input.branchId,
    reservationId: input.reservationId,
    performedByUserId: input.performedByUserId,
    allocationsConsumed: input.allocationsConsumed
      .map((allocation) => ({
        balanceId: allocation.balanceId,
        quantity: allocation.quantity,
      }))
      .sort((left, right) => left.balanceId.localeCompare(right.balanceId)),
    serialNumbers: input.serialNumbers?.map((serial) => serial.trim()).sort() ?? null,
  });
}
