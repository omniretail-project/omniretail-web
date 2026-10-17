import type { InventoryTransfer, Order, Packing, PackingOperation } from "@/core/entities";
import {
  DeliveryMethod,
  InventoryTransferStatus,
  OrderStatus,
  PackingOperationType,
  PackingStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import { assertOrderStatusTransition } from "@/core/orders/orderStatusTransitions";
import type {
  FinalizePackingResult,
  FinalizePackingInput,
  FinalizeTransferPackingInput,
  FinalizeTransferPackingResult,
  PackingMutationResult,
  PackingRepository,
  PackingScope,
  SavePackingPreparationInput,
} from "@/core/repositories";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export interface MockPackingRepositoryTestHooks {
  afterPackingFinalized?: () => void;
}

interface PackingCreationDependencies {
  id(prefix: string): string;
  now(): string;
}

export function createPackingInDatabase(
  db: MockDatabase,
  input: PackingScope & {
    orderId?: string;
    sourceType?: "order" | "transfer";
    sourceId?: string;
    pickingOrderId: string;
    actorUserId: string;
  },
  dependencies: PackingCreationDependencies,
): { packing: Packing; created: boolean } {
  if (input.sourceType === "transfer" && (!input.sourceId || input.orderId !== undefined)) {
    throw new Error("Transfer Packing requires sourceId without orderId");
  }
  if (input.sourceType !== "transfer" && !input.orderId) {
    throw new Error("Order Packing requires orderId");
  }
  const existing = db.packings.find(
    (item) =>
      item.tenantId === input.tenantId &&
      item.branchId === input.branchId &&
      (input.sourceType === "transfer"
        ? item.sourceType === "transfer" && item.sourceId === input.sourceId
        : item.sourceType !== "transfer" && item.orderId === input.orderId),
  );
  if (existing) {
    if (existing.pickingOrderId !== input.pickingOrderId) {
      throw new Error(`Packing relation conflict for Order: ${input.orderId}`);
    }
    return { packing: existing, created: false };
  }
  if (
    db.packings.some(
      (item) => item.tenantId === input.tenantId && item.pickingOrderId === input.pickingOrderId,
    )
  ) {
    throw new Error(`Packing already exists for PickingOrder: ${input.pickingOrderId}`);
  }
  const now = dependencies.now();
  const packing: Packing = {
    id: dependencies.id("packing"),
    tenantId: input.tenantId,
    branchId: input.branchId,
    ...(input.sourceType === "transfer" ? { sourceType: "transfer" as const, sourceId: input.sourceId } : { orderId: input.orderId }),
    pickingOrderId: input.pickingOrderId,
    status: PackingStatus.in_progress,
    checklist: {
      packageProtectionChecked: false,
      documentIncludedChecked: false,
      recipientVerifiedChecked: false,
    },
    startedByUserId: input.actorUserId,
    startedAt: now,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.packings.push(packing);
  return { packing, created: true };
}

export class MockPackingRepository extends BaseMockRepository implements PackingRepository {
  constructor(
    store: MockDatabaseStore,
    eventBus: DataEventBus,
    private readonly testHooks: MockPackingRepositoryTestHooks = {},
  ) {
    super(store, eventBus);
  }

  async getQueue(scope: PackingScope) {
    return this.read((db) =>
      db.packings.filter(
        (item) =>
          item.tenantId === scope.tenantId &&
          item.branchId === scope.branchId &&
          item.status === PackingStatus.in_progress,
      ),
    );
  }

  async getById(scope: PackingScope, packingId: string) {
    return this.read(
      (db) =>
        db.packings.find(
          (item) =>
            item.id === packingId &&
            item.tenantId === scope.tenantId &&
            item.branchId === scope.branchId,
        ) ?? null,
    );
  }

  async getByOrder(scope: PackingScope, orderId: string) {
    return this.read(
      (db) =>
        db.packings.find(
          (item) =>
            item.sourceType !== "transfer" && item.orderId === orderId &&
            item.tenantId === scope.tenantId &&
            item.branchId === scope.branchId,
        ) ?? null,
    );
  }

  async getBySource(scope: PackingScope, sourceType: "order" | "transfer", sourceId: string) {
    return this.read((db) => db.packings.find((item) =>
      item.tenantId === scope.tenantId && item.branchId === scope.branchId &&
      (item.sourceType ?? "order") === sourceType &&
      (sourceType === "transfer" ? item.sourceId : item.sourceId ?? item.orderId) === sourceId) ?? null);
  }

  async savePreparation(
    input: Parameters<PackingRepository["savePreparation"]>[0],
  ): Promise<PackingMutationResult> {
    const operationId = requireOperationId(input.operationId);
    const normalized = normalizePreparation(input);
    const fingerprint = fingerprintFor(PackingOperationType.save_preparation, {
      checklist: normalized.checklist,
      totalWeight: normalized.totalWeight ?? null,
      packageCount: normalized.packageCount ?? null,
    });
    const result = this.store.transact((db) => {
      const packing = this.findScopedPacking(db, input, input.packingId);
      this.assertActor(input.actorUserId, input.tenantId, db);
      const retry = this.findRetry(
        db,
        packing,
        operationId,
        fingerprint,
        PackingOperationType.save_preparation,
      );
      if (retry) return { packing, idempotent: true, changed: false };
      this.assertMutable(packing, input.expectedVersion);
      if (packing.sourceType === "transfer") {
        this.findPackingTransfer(db, packing);
      } else {
        this.assertPreparationMatchesDelivery(this.findPackingOrder(db, packing), normalized);
      }
      const labelDataChanged =
        packing.totalWeight !== normalized.totalWeight ||
        packing.packageCount !== normalized.packageCount;
      const changed =
        labelDataChanged ||
        JSON.stringify(packing.checklist) !== JSON.stringify(normalized.checklist);
      if (changed) {
        packing.checklist = normalized.checklist;
        packing.totalWeight = normalized.totalWeight;
        packing.packageCount = normalized.packageCount;
        if (labelDataChanged) clearLabel(packing);
        packing.version += 1;
        packing.updatedAt = this.now();
      }
      this.recordOperation(
        db,
        packing,
        operationId,
        fingerprint,
        PackingOperationType.save_preparation,
      );
      return { packing, idempotent: false, changed };
    });
    if (result.changed) this.emitPackingChanged(result.packing, "updated");
    return { packing: result.packing, idempotent: result.idempotent };
  }

  async generateLabel(
    input: Parameters<PackingRepository["generateLabel"]>[0],
  ): Promise<PackingMutationResult> {
    if (this.read((db) => db.packings.some((item) => item.id === input.packingId &&
      item.sourceType === "transfer"))) {
      const result = this.store.transact((db) => {
        const packing = this.findScopedPacking(db, input, input.packingId);
        this.assertActor(input.actorUserId, input.tenantId, db);
        const operationId = requireOperationId(input.operationId);
        const type = PackingOperationType.generate_label;
        const fingerprint = fingerprintFor(type, {});
        if (this.findRetry(db, packing, operationId, fingerprint, type)) {
          return { packing, idempotent: true, changed: false };
        }
        this.assertMutable(packing, input.expectedVersion);
        const transfer = this.findPackingTransfer(db, packing);
        assertChecklistComplete(packing);
        assertHomeDeliveryMeasurements(packing);
        packing.version += 1;
        packing.labelGenerationId = this.id("packing-label-generation");
        packing.labelCode = `LBL-${transfer.number}-${packing.version}`;
        packing.labelGeneratedAt = this.now();
        packing.labelPrintedAt = undefined;
        packing.updatedAt = packing.labelGeneratedAt;
        this.recordOperation(db, packing, operationId, fingerprint, type);
        return { packing, idempotent: false, changed: true };
      });
      if (result.changed) this.emitPackingChanged(result.packing, "updated");
      return { packing: result.packing, idempotent: result.idempotent };
    }
    return this.mutate(input, PackingOperationType.generate_label, {}, (packing, order) => {
      if (order.deliveryMethod !== DeliveryMethod.home_delivery) {
        throw new Error("Packing label is only available for home delivery");
      }
      assertChecklistComplete(packing);
      assertHomeDeliveryMeasurements(packing);
      packing.version += 1;
      packing.labelGenerationId = this.id("packing-label-generation");
      packing.labelCode = `LBL-${order.orderNumber}-${packing.version}`;
      packing.labelGeneratedAt = this.now();
      packing.labelPrintedAt = undefined;
    });
  }

  async registerLabelPrint(
    input: Parameters<PackingRepository["registerLabelPrint"]>[0],
  ): Promise<PackingMutationResult> {
    const operationId = requireOperationId(input.operationId);
    const labelGenerationId = input.labelGenerationId.trim();
    const fingerprint = fingerprintFor(PackingOperationType.register_label_print, {
      labelGenerationId,
    });
    const result = this.store.transact((db) => {
      const packing = this.findScopedPacking(db, input, input.packingId);
      this.assertActor(input.actorUserId, input.tenantId, db);
      const retry = this.findRetry(
        db,
        packing,
        operationId,
        fingerprint,
        PackingOperationType.register_label_print,
      );
      if (retry) return { packing, idempotent: true, changed: false };
      if (!Number.isInteger(input.expectedVersion) || packing.version !== input.expectedVersion) {
        throw new Error(`Packing version conflict: ${packing.id}`);
      }
      const source = packing.sourceType === "transfer"
        ? this.findPackingTransfer(db, packing)
        : this.findPackingOrder(db, packing);
      if ("deliveryMethod" in source && source.deliveryMethod !== DeliveryMethod.home_delivery) {
        throw new Error("Packing label is only available for home delivery");
      }
      if (!labelGenerationId || packing.labelGenerationId !== labelGenerationId) {
        throw new Error("Packing label generation is stale or missing");
      }
      if (!packing.labelGeneratedAt || !packing.labelCode) {
        throw new Error("Packing label has not been generated");
      }
      const changed = packing.labelPrintedAt === undefined;
      if (changed) {
        packing.version += 1;
        packing.labelPrintedAt = this.now();
        packing.updatedAt = packing.labelPrintedAt;
      }
      this.recordOperation(
        db,
        packing,
        operationId,
        fingerprint,
        PackingOperationType.register_label_print,
      );
      return { packing, idempotent: false, changed };
    });
    if (result.changed) this.emitPackingChanged(result.packing, "updated");
    return { packing: result.packing, idempotent: result.idempotent };
  }

  finalize(input: FinalizePackingInput): Promise<FinalizePackingResult>;
  finalize(input: FinalizeTransferPackingInput): Promise<FinalizeTransferPackingResult>;
  async finalize(
    input: FinalizePackingInput | FinalizeTransferPackingInput,
  ): Promise<FinalizePackingResult | FinalizeTransferPackingResult> {
    if (input.sourceType === "transfer") return this.finalizeTransfer(input);
    const operationId = requireOperationId(input.operationId);
    const fingerprint = fingerprintFor(PackingOperationType.finalize, {});
    const result = this.store.transact((db) => {
      const packing = this.findScopedPacking(db, input, input.packingId);
      this.assertActor(input.actorUserId, input.tenantId, db);
      const order = this.findPackingOrder(db, packing);
      const retry = this.findRetry(
        db,
        packing,
        operationId,
        fingerprint,
        PackingOperationType.finalize,
      );
      if (retry) {
        if (packing.status !== PackingStatus.finalized || !isReadyAfterPacking(order)) {
          throw new Error(`Packing retry state conflict: ${packing.id}`);
        }
        return { packing, order, idempotent: true, changed: false };
      }
      this.assertMutable(packing, input.expectedVersion);
      if (order.status !== OrderStatus.packing) {
        throw new Error(`Order is not in packing: ${order.id}`);
      }
      assertChecklistComplete(packing);
      const nextStatus = getFinalizedOrderStatus(order.deliveryMethod);
      if (order.deliveryMethod === DeliveryMethod.home_delivery) {
        assertHomeDeliveryMeasurements(packing);
        if (!packing.labelGenerationId || !packing.labelGeneratedAt || !packing.labelCode) {
          throw new Error("Packing label has not been generated");
        }
        if (!packing.labelPrintedAt) throw new Error("Packing label print is required");
      } else if (
        packing.totalWeight !== undefined ||
        packing.packageCount !== undefined ||
        packing.labelGenerationId !== undefined ||
        packing.labelCode !== undefined ||
        packing.labelGeneratedAt !== undefined ||
        packing.labelPrintedAt !== undefined
      ) {
        throw new Error("Store pickup Packing cannot contain shipment data");
      }
      const now = this.now();
      packing.status = PackingStatus.finalized;
      packing.finalizedByUserId = input.actorUserId;
      packing.finalizedAt = now;
      packing.version += 1;
      packing.updatedAt = now;
      this.testHooks.afterPackingFinalized?.();
      assertOrderStatusTransition(order.status, nextStatus, "packing");
      order.status = nextStatus;
      order.updatedAt = now;
      this.recordOperation(db, packing, operationId, fingerprint, PackingOperationType.finalize);
      return { packing, order, idempotent: false, changed: true };
    });
    if (result.changed) {
      this.emitPackingChanged(result.packing, "status_changed");
      this.emitSafely("order.changed", {
        entityId: result.order.id,
        tenantId: result.order.tenantId,
        branchId: result.order.branchId,
        orderId: result.order.id,
        action: "status_changed",
      });
    }
    return { packing: result.packing, order: result.order, idempotent: result.idempotent };
  }

  private mutate(
    input: Parameters<PackingRepository["generateLabel"]>[0],
    type: PackingOperationType,
    payload: Record<string, unknown>,
    mutation: (packing: Packing, order: Order) => void,
  ): Promise<PackingMutationResult> {
    const operationId = requireOperationId(input.operationId);
    const fingerprint = fingerprintFor(type, payload);
    const result = this.store.transact((db) => {
      const packing = this.findScopedPacking(db, input, input.packingId);
      this.assertActor(input.actorUserId, input.tenantId, db);
      const retry = this.findRetry(db, packing, operationId, fingerprint, type);
      if (retry) return { packing, idempotent: true, changed: false };
      this.assertMutable(packing, input.expectedVersion);
      const order = this.findPackingOrder(db, packing);
      if (order.status !== OrderStatus.packing)
        throw new Error(`Order is not in packing: ${order.id}`);
      mutation(packing, order);
      packing.updatedAt = this.now();
      this.recordOperation(db, packing, operationId, fingerprint, type);
      return { packing, idempotent: false, changed: true };
    });
    if (result.changed) this.emitPackingChanged(result.packing, "updated");
    return Promise.resolve({ packing: result.packing, idempotent: result.idempotent });
  }

  private findScopedPacking(db: MockDatabase, scope: PackingScope, packingId: string): Packing {
    const packing = db.packings.find(
      (item) =>
        item.id === packingId &&
        item.tenantId === scope.tenantId &&
        item.branchId === scope.branchId,
    );
    if (!packing) throw new Error(`Packing not found for tenant/branch: ${packingId}`);
    return packing;
  }

  private findPackingOrder(db: MockDatabase, packing: Packing): Order {
    if (packing.sourceType === "transfer") throw new Error("Transfer Packing is not an Order");
    const order = db.orders.find(
      (item) =>
        item.id === packing.orderId &&
        item.tenantId === packing.tenantId &&
        item.branchId === packing.branchId,
    );
    if (!order) throw new Error(`Order not found for Packing: ${packing.id}`);
    return order;
  }

  private findPackingTransfer(db: MockDatabase, packing: Packing): InventoryTransfer {
    const transfer = db.inventoryTransfers.find((item) => item.id === packing.sourceId &&
      item.tenantId === packing.tenantId && item.sourceBranchId === packing.branchId &&
      (item.status === InventoryTransferStatus.preparing ||
        (packing.status === PackingStatus.finalized &&
          [InventoryTransferStatus.inTransit, InventoryTransferStatus.received].includes(item.status))));
    if (!transfer || packing.orderId !== undefined) {
      throw new Error(`Transfer not found for Packing: ${packing.id}`);
    }
    return transfer;
  }

  private finalizeTransfer(input: FinalizeTransferPackingInput): Promise<FinalizeTransferPackingResult> {
    const operationId = requireOperationId(input.operationId);
    const fingerprint = fingerprintFor(PackingOperationType.finalize, {});
    const result = this.store.transact((db) => {
      const packing = this.findScopedPacking(db, input, input.packingId);
      if (packing.sourceType !== "transfer") throw new Error("Packing source conflict");
      this.assertActor(input.actorUserId, input.tenantId, db);
      const transfer = this.findPackingTransfer(db, packing);
      const retry = this.findRetry(db, packing, operationId, fingerprint, PackingOperationType.finalize);
      if (retry) {
        if (packing.status !== PackingStatus.finalized) throw new Error("Transfer Packing retry conflict");
        return { packing, transfer, idempotent: true, changed: false };
      }
      this.assertMutable(packing, input.expectedVersion);
      assertChecklistComplete(packing);
      assertHomeDeliveryMeasurements(packing);
      if (!packing.labelGenerationId || !packing.labelGeneratedAt || !packing.labelPrintedAt ||
        !packing.labelCode) throw new Error("Transfer Packing label and print are required");
      packing.status = PackingStatus.finalized;
      packing.finalizedByUserId = input.actorUserId;
      packing.finalizedAt = this.now();
      packing.version += 1;
      packing.updatedAt = packing.finalizedAt;
      this.recordOperation(db, packing, operationId, fingerprint, PackingOperationType.finalize);
      return { packing, transfer, idempotent: false, changed: true };
    });
    if (result.changed) this.emitPackingChanged(result.packing, "status_changed");
    return Promise.resolve({ packing: result.packing, transfer: result.transfer,
      idempotent: result.idempotent });
  }

  private assertActor(actorUserId: string, tenantId: string, db: MockDatabase): void {
    const actor = db.users.find(
      (user) =>
        user.id === actorUserId &&
        user.tenantId === tenantId &&
        user.status === UserStatus.active &&
        user.type === UserType.employee,
    );
    if (!actor) throw new Error(`Packing actor not found for tenant: ${actorUserId}`);
  }

  private assertMutable(packing: Packing, expectedVersion: number): void {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new Error("Packing expectedVersion is invalid");
    }
    if (packing.status !== PackingStatus.in_progress)
      throw new Error(`Packing is finalized: ${packing.id}`);
    if (packing.version !== expectedVersion)
      throw new Error(`Packing version conflict: ${packing.id}`);
  }

  private assertPreparationMatchesDelivery(
    order: Order,
    input: ReturnType<typeof normalizePreparation>,
  ): void {
    if (order.status !== OrderStatus.packing)
      throw new Error(`Order is not in packing: ${order.id}`);
    if (order.deliveryMethod === DeliveryMethod.immediate)
      throw new Error("Immediate delivery cannot enter Packing");
    if (
      order.deliveryMethod === DeliveryMethod.store_pickup &&
      (input.totalWeight !== undefined || input.packageCount !== undefined)
    ) {
      throw new Error("Store pickup Packing cannot contain weight or packages");
    }
  }

  private findRetry(
    db: MockDatabase,
    packing: Packing,
    operationId: string,
    fingerprint: string,
    type: PackingOperationType,
  ): PackingOperation | null {
    const operation = db.packingOperations.find(
      (item) => item.tenantId === packing.tenantId && item.operationId === operationId,
    );
    if (!operation) return null;
    if (
      operation.packingId !== packing.id ||
      operation.type !== type ||
      operation.fingerprint !== fingerprint
    ) {
      throw new Error(`Packing operation conflict: ${operationId}`);
    }
    return operation;
  }

  private recordOperation(
    db: MockDatabase,
    packing: Packing,
    operationId: string,
    fingerprint: string,
    type: PackingOperationType,
  ): void {
    db.packingOperations.push({
      id: this.id("packing-operation"),
      tenantId: packing.tenantId,
      branchId: packing.branchId,
      packingId: packing.id,
      operationId,
      type,
      fingerprint,
      resultVersion: packing.version,
      createdAt: this.now(),
    });
  }

  private emitPackingChanged(packing: Packing, action: DataEventPayload["action"]): void {
    this.emitSafely("packing.changed", {
      entityId: packing.id,
      tenantId: packing.tenantId,
      branchId: packing.branchId,
      packingId: packing.id,
      orderId: packing.orderId,
      action,
    });
  }

  private emitSafely(event: DataEventName, payload: DataEventPayload): void {
    try {
      this.emit(event, payload);
    } catch {
      // Authoritative state was committed before notifying observers.
    }
  }
}

function normalizePreparation(input: SavePackingPreparationInput) {
  const checklist = {
    packageProtectionChecked: input.checklist.packageProtectionChecked === true,
    documentIncludedChecked: input.checklist.documentIncludedChecked === true,
    recipientVerifiedChecked: input.checklist.recipientVerifiedChecked === true,
  };
  const totalWeight = input.totalWeight;
  if (totalWeight !== undefined && (!Number.isFinite(totalWeight) || totalWeight <= 0)) {
    throw new Error("Packing totalWeight must be positive");
  }
  const packageCount = input.packageCount;
  if (packageCount !== undefined && (!Number.isInteger(packageCount) || packageCount < 1)) {
    throw new Error("Packing packageCount must be an integer greater than zero");
  }
  return { checklist, totalWeight, packageCount };
}

function requireOperationId(value: string): string {
  const operationId = value.trim();
  if (!operationId) throw new Error("Packing operationId is required");
  return operationId;
}

function fingerprintFor(type: PackingOperationType, payload: Record<string, unknown>): string {
  return JSON.stringify({ type, ...payload });
}

function assertChecklistComplete(packing: Packing): void {
  if (!Object.values(packing.checklist).every(Boolean)) {
    throw new Error("Packing checklist is incomplete");
  }
}

function assertHomeDeliveryMeasurements(packing: Packing): void {
  if (!packing.totalWeight || packing.totalWeight <= 0)
    throw new Error("Packing totalWeight is required");
  if (
    !packing.packageCount ||
    !Number.isInteger(packing.packageCount) ||
    packing.packageCount < 1
  ) {
    throw new Error("Packing packageCount is required");
  }
}

function clearLabel(packing: Packing): void {
  packing.labelGenerationId = undefined;
  packing.labelCode = undefined;
  packing.labelGeneratedAt = undefined;
  packing.labelPrintedAt = undefined;
}

function getFinalizedOrderStatus(deliveryMethod: DeliveryMethod): OrderStatus {
  if (deliveryMethod === DeliveryMethod.home_delivery) return OrderStatus.ready_for_dispatch;
  if (deliveryMethod === DeliveryMethod.store_pickup) return OrderStatus.ready_for_pickup;
  throw new Error(`Packing cannot finalize delivery method: ${deliveryMethod}`);
}

function isReadyAfterPacking(order: Order): boolean {
  return (
    (order.deliveryMethod === DeliveryMethod.home_delivery &&
      order.status === OrderStatus.ready_for_dispatch) ||
    (order.deliveryMethod === DeliveryMethod.store_pickup &&
      order.status === OrderStatus.ready_for_pickup)
  );
}
