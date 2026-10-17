import { InventoryMovementType, LocationStatus, ProductType } from "@/core/enums";
import type {
  InventoryBalance,
  InventoryMovement,
  InventoryReservation,
  ProductInventorySettings,
  StorageLocation,
} from "@/core/entities";
import type {
  ConsumeInventoryReservationInput,
  ConsumeInventoryReservationResult,
  InventoryRepository,
  RegisterInventoryMovementInput,
  ReleaseInventoryReservationInput,
  ReserveOrderItemInput,
  GetPickingInventoryAvailabilityInput,
  GetPickingFulfillmentTraceInput,
  PickingFulfillmentItemTrace,
  PickingFulfillmentTraceAllocation,
} from "@/core/repositories";
import { buildPickingInventoryAvailability } from "@/core/inventory/pickingAvailability";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import {
  consumeInventoryReservationInDatabase,
  releaseInventoryReservationInDatabase,
  reserveOrderItemInDatabase,
} from "@/infrastructure/mock/repositories/inventoryReservationMutations";
import {
  getClaimedPickingSerialNumbers,
  planPickingAllocationCapacity,
} from "@/infrastructure/mock/repositories/pickingSelectionMutations";

export class MockInventoryRepository extends BaseMockRepository implements InventoryRepository {
  async getBalances() {
    return this.read((db) => db.inventoryBalances);
  }
  async getReservationById(tenantId: string, reservationId: string) {
    return this.read(
      (db) =>
        db.inventoryReservations.find(
          (item) => item.tenantId === tenantId && item.id === reservationId,
        ) ?? null,
    );
  }
  async getReservationByOrderItem(tenantId: string, orderItemId: string) {
    return this.read(
      (db) =>
        db.inventoryReservations.find(
          (item) => item.tenantId === tenantId && item.orderItemId === orderItemId,
        ) ?? null,
    );
  }
  async reserveForOrderItem(input: ReserveOrderItemInput) {
    const result = this.store.transact((db) =>
      reserveOrderItemInDatabase(db, input, {
        id: (prefix) => this.id(prefix),
        now: () => this.now(),
      }),
    );

    if (result.changed) this.emitStockChanged(result.reservation);
    return result.reservation;
  }
  async releaseReservation(input: ReleaseInventoryReservationInput) {
    const result = this.store.transact((db) => {
      if (
        db.inventoryReservations.some(
          (item) => item.id === input.reservationId && item.sourceType === "transfer",
        )
      ) {
        throw new Error("Transfer reservations can only be released by Transfer cancellation");
      }
      return releaseInventoryReservationInDatabase(db, input, { now: () => this.now() });
    });

    if (result.changed) this.emitStockChanged(result.reservation);
    return result.reservation;
  }
  async consumeReservation(
    input: ConsumeInventoryReservationInput,
  ): Promise<ConsumeInventoryReservationResult> {
    const result = this.store.transact((db) => {
      if (
        db.inventoryReservations.some(
          (item) => item.id === input.reservationId && item.sourceType === "transfer",
        )
      ) {
        throw new Error("Transfer reservations can only be consumed by Transfer Dispatch");
      }
      return consumeInventoryReservationInDatabase(db, input, {
        id: (prefix) => this.id(prefix),
        now: () => this.now(),
      });
    });

    if (result.changed) this.emitConsumedReservation(result);
    return {
      reservation: result.reservation,
      inventoryMovements: result.inventoryMovements,
      idempotent: result.idempotent,
    };
  }
  async getPickingAvailability(input: GetPickingInventoryAvailabilityInput) {
    return this.read((db) => {
      const pickingOrder = db.pickingOrders.find(
        (item) =>
          item.id === input.pickingOrderId &&
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId &&
          (item.sourceType === "transfer"
            ? input.sourceType === "transfer" && item.sourceId === input.sourceId
            : input.sourceType !== "transfer" && item.orderId === input.orderId),
      );
      if (!pickingOrder) {
        throw new Error(`PickingOrder not found for tenant/branch: ${input.pickingOrderId}`);
      }
      const order =
        pickingOrder.sourceType === "transfer"
          ? null
          : db.orders.find(
              (item) =>
                item.id === input.orderId &&
                item.tenantId === input.tenantId &&
                item.branchId === input.branchId,
            );
      if (!order) {
        const transfer =
          pickingOrder.sourceType === "transfer" &&
          db.inventoryTransfers.find(
            (item) =>
              item.id === pickingOrder.sourceId &&
              item.id === input.sourceId &&
              item.tenantId === input.tenantId &&
              item.sourceBranchId === input.branchId,
          );
        if (!transfer)
          throw new Error(`Fulfillment source not found for tenant/branch: ${input.sourceId}`);
      }
      const pickingItems = db.pickingItems.filter(
        (item) => item.pickingOrderId === pickingOrder.id && item.productId === input.productId,
      );
      if (pickingItems.length === 0) {
        throw new Error(`Product is not part of PickingOrder: ${input.productId}`);
      }
      const product = db.products.find(
        (item) => item.id === input.productId && item.tenantId === input.tenantId,
      );
      if (!product) throw new Error(`Product not found for tenant: ${input.productId}`);

      const availability = buildPickingInventoryAvailability({
        ...input,
        product,
        balances: db.inventoryBalances,
        reservations: db.inventoryReservations,
        lots: db.stockLots,
        serials: db.serialNumbers,
        locations: db.storageLocations,
        at: input.at ?? this.now(),
      });
      const claimedSerials = getClaimedPickingSerialNumbers(db, input);
      const pickingItem = input.pickingItemId
        ? pickingItems.find((item) => item.id === input.pickingItemId)
        : undefined;
      if (input.pickingItemId && !pickingItem) {
        throw new Error(`PickingItem not found for product: ${input.pickingItemId}`);
      }
      const reservation =
        pickingItem &&
        db.inventoryReservations.find(
          (item) =>
            item.tenantId === input.tenantId &&
            item.branchId === input.branchId &&
            item.orderItemId === pickingItem.orderItemId &&
            item.productId === input.productId &&
            (pickingOrder.sourceType === "transfer"
              ? item.sourceType === "transfer" && item.sourceId === pickingOrder.sourceId
              : item.sourceType !== "transfer" && item.orderId === pickingOrder.orderId),
        );
      // The mutation planner, not React, decides which FEFO lots belong to this line.
      const selectableAllocations =
        product.tracking.lot && product.tracking.serial && pickingItem && reservation
          ? planPickingAllocationCapacity(
              db,
              pickingItem,
              reservation,
              product,
              pickingItem.requestedQuantity,
              input.at ?? this.now(),
              true,
            ).planned
          : null;
      return {
        ...availability,
        locations: availability.locations.map((location) => ({
          ...location,
          serialNumbers: location.serialNumbers
            .filter(
              (serial) =>
                !claimedSerials.has(serial.serialNumber) &&
                (!product.tracking.lot ||
                  !product.tracking.serial ||
                  selectableAllocations?.some(
                    (allocation) =>
                      allocation.balanceId === location.balanceId &&
                      allocation.lotId === serial.lotId,
                  )),
            )
            .sort((left, right) => left.id.localeCompare(right.id)),
          lots: location.lots.map((lot) => ({
            ...lot,
            serialNumbers: lot.serialNumbers.filter(
              (serial) => !claimedSerials.has(serial.serialNumber),
            ),
          })),
        })),
      };
    });
  }
  async getPickingFulfillmentTrace(
    input: GetPickingFulfillmentTraceInput,
  ): Promise<PickingFulfillmentItemTrace[]> {
    if (
      !input.tenantId.trim() ||
      !input.branchId.trim() ||
      !input.orderId.trim() ||
      !input.pickingOrderId.trim()
    ) {
      throw new Error("Picking fulfillment trace scope is required");
    }
    return this.read((db) => {
      const order = db.orders.find(
        (item) =>
          item.id === input.orderId &&
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId,
      );
      if (!order) throw new Error(`Order not found for fulfillment trace: ${input.orderId}`);
      const pickingOrder = db.pickingOrders.find(
        (item) =>
          item.id === input.pickingOrderId &&
          item.orderId === order.id &&
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId,
      );
      if (!pickingOrder) {
        throw new Error(`PickingOrder not found for fulfillment trace: ${input.pickingOrderId}`);
      }

      return db.pickingItems
        .filter((item) => item.pickingOrderId === pickingOrder.id)
        .map((item): PickingFulfillmentItemTrace => {
          const product = db.products.find(
            (candidate) => candidate.id === item.productId && candidate.tenantId === input.tenantId,
          );
          if (!product)
            throw new Error(`Product not found for fulfillment trace: ${item.productId}`);
          const reservations = db.inventoryReservations.filter(
            (reservation) =>
              reservation.tenantId === input.tenantId &&
              reservation.branchId === input.branchId &&
              reservation.orderId === order.id &&
              reservation.orderItemId === item.orderItemId &&
              reservation.productId === item.productId,
          );
          if (reservations.length > 1) {
            throw new Error(`Duplicate reservations for PickingItem: ${item.id}`);
          }
          const reservation = reservations[0];
          const movementIds = new Set(
            db.inventoryReservationConsumeOperations
              .filter(
                (operation) =>
                  operation.tenantId === input.tenantId &&
                  operation.branchId === input.branchId &&
                  operation.reservationId === reservation?.id,
              )
              .flatMap((operation) => operation.inventoryMovementIds),
          );
          const movements = reservation
            ? db.inventoryMovements
                .filter(
                  (movement) =>
                    (movementIds.has(movement.id) ||
                      (movement.referenceType === "inventoryReservation" &&
                        movement.referenceId === reservation.id)) &&
                    movement.tenantId === input.tenantId &&
                    movement.branchId === input.branchId &&
                    movement.productId === item.productId &&
                    movement.type === InventoryMovementType.out,
                )
                .sort(
                  (left, right) =>
                    left.createdAt.localeCompare(right.createdAt) ||
                    left.id.localeCompare(right.id),
                )
            : [];
          if (
            product.productType === ProductType.physical &&
            product.tracking.stock &&
            item.pickedQuantity > 0 &&
            !reservation
          ) {
            throw new Error(`Reservation evidence not found for PickingItem: ${item.id}`);
          }
          const selected =
            movements.length === 0
              ? (item.pickedAllocations ?? []).flatMap<{
                  balanceId: string;
                  locationId?: string;
                  lotId?: string;
                  quantity: number;
                  serialNumber?: string;
                }>((picked) =>
                  picked.serialNumbers?.length
                    ? picked.serialNumbers.map((number) => ({
                        ...picked,
                        quantity: 1,
                        serialNumber: number,
                      }))
                    : [{ ...picked, serialNumber: undefined }],
                )
              : [];
          const allocations: PickingFulfillmentTraceAllocation[] = movements.map((movement) => {
            const location = movement.fromLocationId
              ? db.storageLocations.find(
                  (candidate) =>
                    candidate.id === movement.fromLocationId &&
                    candidate.tenantId === input.tenantId &&
                    candidate.branchId === input.branchId,
                )
              : undefined;
            if (movement.fromLocationId && !location) {
              throw new Error(`Location evidence not found for InventoryMovement: ${movement.id}`);
            }
            const lot = movement.lotId
              ? db.stockLots.find(
                  (candidate) =>
                    candidate.id === movement.lotId &&
                    candidate.tenantId === input.tenantId &&
                    candidate.branchId === input.branchId &&
                    candidate.productId === item.productId &&
                    (candidate.locationId ?? null) === (movement.fromLocationId ?? null),
                )
              : undefined;
            if (movement.lotId && !lot) {
              throw new Error(`Lot evidence not found for InventoryMovement: ${movement.id}`);
            }
            const serial = movement.serialNumberId
              ? db.serialNumbers.find(
                  (candidate) =>
                    candidate.id === movement.serialNumberId &&
                    candidate.tenantId === input.tenantId &&
                    candidate.branchId === input.branchId &&
                    candidate.productId === item.productId &&
                    (candidate.locationId ?? null) === (movement.fromLocationId ?? null) &&
                    (candidate.lotId ?? null) === (movement.lotId ?? null),
                )
              : undefined;
            if (movement.serialNumberId && !serial) {
              throw new Error(`Serial evidence not found for InventoryMovement: ${movement.id}`);
            }
            return {
              inventoryMovementId: movement.id,
              reservationId: reservation!.id,
              quantity: movement.quantity,
              location: location
                ? { id: location.id, code: location.code, name: location.name }
                : undefined,
              lot: lot
                ? {
                    id: lot.id,
                    number: lot.lotNumber,
                    expiresAt: lot.expirationDate,
                  }
                : undefined,
              serial: serial ? { id: serial.id, number: serial.serialNumber } : undefined,
              consumedAt: movement.createdAt,
            };
          });
          selected.forEach((picked) => {
            const location = picked.locationId
              ? db.storageLocations.find(
                  (entry) =>
                    entry.id === picked.locationId &&
                    entry.tenantId === input.tenantId &&
                    entry.branchId === input.branchId,
                )
              : undefined;
            const lot = picked.lotId
              ? db.stockLots.find(
                  (entry) =>
                    entry.id === picked.lotId &&
                    entry.tenantId === input.tenantId &&
                    entry.branchId === input.branchId &&
                    entry.productId === item.productId,
                )
              : undefined;
            const serial = picked.serialNumber
              ? db.serialNumbers.find(
                  (entry) =>
                    entry.serialNumber === picked.serialNumber &&
                    entry.tenantId === input.tenantId &&
                    entry.branchId === input.branchId &&
                    entry.productId === item.productId,
                )
              : undefined;
            if (
              (picked.locationId && !location) ||
              (picked.lotId && !lot) ||
              (picked.serialNumber && !serial)
            ) {
              throw new Error(`Picking selection trace is incomplete: ${item.id}`);
            }
            allocations.push({
              inventoryMovementId: undefined,
              reservationId: reservation!.id,
              quantity: picked.quantity,
              location: location
                ? { id: location.id, code: location.code, name: location.name }
                : undefined,
              lot: lot
                ? { id: lot.id, number: lot.lotNumber, expiresAt: lot.expirationDate }
                : undefined,
              serial: serial ? { id: serial.id, number: serial.serialNumber } : undefined,
              consumedAt: undefined,
            });
          });
          const tracedQuantity = allocations.reduce(
            (total, allocation) => total + allocation.quantity,
            0,
          );
          if (
            product.productType === ProductType.physical &&
            product.tracking.stock &&
            tracedQuantity !== item.pickedQuantity
          ) {
            throw new Error(`Picking trace quantity conflict for PickingItem: ${item.id}`);
          }
          return {
            pickingItemId: item.id,
            orderItemId: item.orderItemId,
            productId: item.productId,
            requestedQuantity: item.requestedQuantity,
            pickedQuantity: item.pickedQuantity,
            allocations,
          };
        });
    });
  }
  async getBalanceByProduct(productId: string, branchId?: string) {
    return this.read((db) =>
      db.inventoryBalances.filter(
        (item) => item.productId === productId && (!branchId || item.branchId === branchId),
      ),
    );
  }
  async getProductBalances(productId: string, branchId: string, tenantId: string) {
    return this.read((db) =>
      db.inventoryBalances.filter(
        (item) =>
          item.tenantId === tenantId && item.branchId === branchId && item.productId === productId,
      ),
    );
  }
  async getMovements(productId?: string) {
    return this.read((db) =>
      db.inventoryMovements.filter((item) => !productId || item.productId === productId),
    );
  }
  async getMovementPage(
    _params: Parameters<InventoryRepository["getMovementPage"]>[0],
  ): ReturnType<InventoryRepository["getMovementPage"]> {
    void _params;
    throw new Error("Server-side inventory movement pages are only available in API mode.");
  }
  async getStockPage(
    _params: Parameters<InventoryRepository["getStockPage"]>[0],
  ): ReturnType<InventoryRepository["getStockPage"]> {
    void _params;
    throw new Error("Server-side inventory stock pages are only available in API mode.");
  }
  async getInventoryAlertPage(
    _params: Parameters<InventoryRepository["getInventoryAlertPage"]>[0],
  ): ReturnType<InventoryRepository["getInventoryAlertPage"]> {
    void _params;
    throw new Error("Server-side inventory alert pages are only available in API mode.");
  }
  async getStockBatch(): Promise<never> {
    throw new Error("Batch stock reads are only available in API mode.");
  }
  async getKitAvailability(): Promise<never> {
    throw new Error("Kit availability details are only available in API mode.");
  }
  async getOtherBranchesAvailability(): Promise<never> {
    throw new Error("Other-branch availability is only available in API mode.");
  }
  async getLots(productId?: string) {
    return this.read((db) =>
      db.stockLots.filter((item) => !productId || item.productId === productId),
    );
  }
  async getSerialNumbers(productId?: string) {
    return this.read((db) =>
      db.serialNumbers.filter((item) => !productId || item.productId === productId),
    );
  }
  async getLocations(branchId?: string) {
    return this.read((db) =>
      db.storageLocations.filter((item) => !branchId || item.branchId === branchId),
    );
  }
  async createLocation(input: Omit<StorageLocation, "id" | "createdAt" | "updatedAt">) {
    const location = this.store.mutate((db) => {
      const now = this.now();
      const created = {
        ...input,
        id: this.id("location"),
        createdAt: now,
        updatedAt: now,
      };
      db.storageLocations.push(created);
      return created;
    });
    this.emit("inventory.changed", {
      entityId: location.id,
      tenantId: location.tenantId,
      branchId: location.branchId,
      action: "created",
      metadata: { entity: "StorageLocation" },
    });
    return location;
  }
  async updateLocation(
    id: string,
    input: Partial<Omit<StorageLocation, "id" | "createdAt" | "updatedAt">>,
  ) {
    const location = this.store.mutate((db) => {
      const current = db.storageLocations.find((item) => item.id === id);
      if (!current) throw this.missing("StorageLocation", id);
      const changesToUnavailableStatus =
        input.status !== undefined &&
        input.status !== current.status &&
        input.status !== LocationStatus.active;
      if (
        changesToUnavailableStatus &&
        db.productInventorySettings.some((settings) => settings.defaultLocationId === id)
      ) {
        throw new Error("No se puede archivar ni inactivar una ubicacion asignada a productos.");
      }
      return this.updateById(db.storageLocations, id, input, "StorageLocation");
    });
    this.emit("inventory.changed", {
      entityId: location.id,
      tenantId: location.tenantId,
      branchId: location.branchId,
      action: input.status === "archived" ? "archived" : "updated",
      metadata: { entity: "StorageLocation" },
    });
    return location;
  }
  async getProductInventorySettings(productId: string, branchId: string) {
    return this.read(
      (db) =>
        db.productInventorySettings.find(
          (item) => item.productId === productId && item.branchId === branchId,
        ) ?? null,
    );
  }
  async upsertProductInventorySettings(
    input: Parameters<InventoryRepository["upsertProductInventorySettings"]>[0],
  ) {
    const result = this.store.mutate((db) => {
      this.assertValidProductInventorySettings(input);
      const product = db.products.find((item) => item.id === input.productId);
      if (!product) throw this.missing("Product", input.productId);
      if (product.tenantId !== input.tenantId) {
        throw new Error("Product inventory settings tenant must match product tenant");
      }
      const branch = db.branches.find((item) => item.id === input.branchId);
      if (!branch) throw this.missing("Branch", input.branchId);
      if (branch.tenantId !== input.tenantId) {
        throw new Error("Product inventory settings tenant must match branch tenant");
      }
      if (input.defaultLocationId) {
        const location = db.storageLocations.find((item) => item.id === input.defaultLocationId);
        if (!location) throw this.missing("StorageLocation", input.defaultLocationId);
        if (location.tenantId !== input.tenantId) {
          throw new Error("Default location tenant must match product inventory settings tenant");
        }
        if (location.branchId !== input.branchId) {
          throw new Error("Default location branch must match product inventory settings branch");
        }
        if (location.status !== LocationStatus.active) {
          throw new Error("Default location must be active");
        }
      }

      const now = this.now();
      const existingIndex = db.productInventorySettings.findIndex(
        (item) =>
          item.tenantId === input.tenantId &&
          item.productId === input.productId &&
          item.branchId === input.branchId,
      );

      if (existingIndex >= 0) {
        const current = db.productInventorySettings[existingIndex];
        const updated: ProductInventorySettings = {
          ...current,
          ...input,
          defaultLocationId:
            input.defaultLocationId === undefined
              ? current.defaultLocationId
              : (input.defaultLocationId ?? undefined),
          reorderPoint:
            input.reorderPoint === undefined
              ? current.reorderPoint
              : (input.reorderPoint ?? undefined),
          updatedAt: now,
        };
        db.productInventorySettings[existingIndex] = updated;
        return { settings: updated, action: "updated" as const };
      }

      const created: ProductInventorySettings = {
        ...input,
        id: this.id("product-inventory-settings"),
        reorderPoint: input.reorderPoint ?? undefined,
        defaultLocationId: input.defaultLocationId ?? undefined,
        createdAt: now,
        updatedAt: now,
      };
      db.productInventorySettings.push(created);
      return { settings: created, action: "created" as const };
    });
    this.emit("inventory.changed", {
      entityId: result.settings.id,
      tenantId: result.settings.tenantId,
      branchId: result.settings.branchId,
      productId: result.settings.productId,
      action: result.action,
      metadata: { entity: "ProductInventorySettings" },
    });
    return result.settings;
  }
  async registerMovement(input: RegisterInventoryMovementInput) {
    const movement = this.store.mutate((db) => {
      const product = db.products.find(
        (item) => item.id === input.productId && item.tenantId === input.tenantId,
      );
      if (product?.tracking.lot || product?.tracking.serial) {
        throw new Error("Traceable stock must be mutated through a traceability-aware workflow.");
      }
      const created: InventoryMovement = {
        ...input,
        id: this.id("movement"),
        createdAt: this.now(),
      };
      const movement = this.applyMovementToBalances(db.inventoryBalances, created);
      db.inventoryMovements.push(movement);
      return movement;
    });
    this.emit("inventory.changed", {
      entityId: movement.id,
      tenantId: movement.tenantId,
      branchId: movement.branchId,
      productId: movement.productId,
      action: "created",
    });
    this.emit("stock.changed", {
      tenantId: movement.tenantId,
      branchId: movement.branchId,
      productId: movement.productId,
      action: "updated",
    });
    return movement;
  }
  async adjustStock(input: Omit<RegisterInventoryMovementInput, "type">) {
    return this.registerMovement({ ...input, type: InventoryMovementType.adjustment });
  }
  async transferStock(
    input: Omit<RegisterInventoryMovementInput, "type" | "quantity"> & {
      quantity: number;
      fromLocationId: string;
      toLocationId: string;
    },
  ) {
    return this.registerMovement({ ...input, type: InventoryMovementType.transfer });
  }
  private emitStockChanged(reservation: InventoryReservation): void {
    this.emitSafely("stock.changed", {
      entityId: reservation.id,
      tenantId: reservation.tenantId,
      branchId: reservation.branchId,
      productId: reservation.productId,
      action: "updated",
      metadata: { entity: "InventoryReservation", status: reservation.status },
    });
  }

  private emitConsumedReservation(
    result: Pick<ConsumeInventoryReservationResult, "reservation" | "inventoryMovements">,
  ): void {
    result.inventoryMovements.forEach((movement) => {
      this.emitSafely("inventory.changed", {
        entityId: movement.id,
        tenantId: movement.tenantId,
        branchId: movement.branchId,
        productId: movement.productId,
        action: "created",
      });
    });
    this.emitStockChanged(result.reservation);
  }

  private emitSafely(event: DataEventName, payload: DataEventPayload): void {
    try {
      this.emit(event, payload);
    } catch {
      // The transaction is already committed; listener failures cannot roll it back.
    }
  }

  private applyMovementToBalances(
    balances: InventoryBalance[],
    movement: InventoryMovement,
  ): InventoryMovement {
    const now = this.now();
    const findOrCreate = (locationId?: string) => {
      let balance = balances.find(
        (item) =>
          item.tenantId === movement.tenantId &&
          item.branchId === movement.branchId &&
          item.productId === movement.productId &&
          item.locationId === locationId,
      );
      if (!balance) {
        balance = {
          id: this.id("balance"),
          tenantId: movement.tenantId,
          branchId: movement.branchId,
          productId: movement.productId,
          locationId,
          quantity: 0,
          reservedQuantity: 0,
          updatedAt: now,
        };
        balances.push(balance);
      }
      return balance;
    };
    if (movement.type === InventoryMovementType.transfer) {
      findOrCreate(movement.fromLocationId).quantity -= movement.quantity;
      findOrCreate(movement.toLocationId).quantity += movement.quantity;
    } else {
      const balance = findOrCreate(movement.toLocationId ?? movement.fromLocationId);
      const quantityBefore = balance.quantity;
      const direction = movement.type === InventoryMovementType.out ? -1 : 1;
      balance.quantity += movement.quantity * direction;
      movement.quantityBefore = movement.quantityBefore ?? quantityBefore;
      movement.quantityAfter = movement.quantityAfter ?? balance.quantity;
    }
    balances
      .filter(
        (item) => item.productId === movement.productId && item.branchId === movement.branchId,
      )
      .forEach((item) => {
        item.updatedAt = now;
      });
    return movement;
  }

  private assertValidProductInventorySettings(
    input: Parameters<InventoryRepository["upsertProductInventorySettings"]>[0],
  ): void {
    if (input.minStock < 0) {
      throw new Error("Product inventory settings minStock must be greater than or equal to 0");
    }
    if (typeof input.reorderPoint === "number" && input.reorderPoint < 0) {
      throw new Error("Product inventory settings reorderPoint must be greater than or equal to 0");
    }
  }
}
