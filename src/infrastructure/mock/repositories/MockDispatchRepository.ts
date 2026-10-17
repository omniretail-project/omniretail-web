import type { Dispatch, InventoryMovement, Notification, Package } from "@/core/entities";
import {
  DispatchStatus,
  NotificationChannel,
  NotificationStatus,
  OrderStatus,
  PackingStatus,
  PickingIncidentStatus,
  PickingStatus,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import { assertOrderStatusTransition } from "@/core/orders/orderStatusTransitions";
import type {
  ConfirmDispatchInput,
  ConfirmDispatchResult,
  DispatchNotificationStatus,
  DispatchReadScope,
  DispatchRepository,
  MarkDispatchDeliveredInput,
  MarkDispatchDeliveredResult,
} from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { commitPickedOrderInventoryInDatabase } from "@/infrastructure/mock/repositories/commitPickedOrderInventoryInDatabase";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";

interface DispatchMutationResult extends ConfirmDispatchResult {
  dispatchChanged: boolean;
  orderChanged: boolean;
  notificationChanged: boolean;
  inventoryMovements?: InventoryMovement[];
}

export class MockDispatchRepository extends BaseMockRepository implements DispatchRepository {
  async getAll(scope: DispatchReadScope) {
    return this.read((db) =>
      db.dispatches.filter(
        (item) =>
          item.tenantId === scope.tenantId &&
          (scope.branchId === undefined || item.branchId === scope.branchId),
      ),
    );
  }

  async getById(scope: DispatchReadScope, id: string) {
    return this.read(
      (db) =>
        db.dispatches.find(
          (item) =>
            item.id === id &&
            item.tenantId === scope.tenantId &&
            (scope.branchId === undefined || item.branchId === scope.branchId),
        ) ?? null,
    );
  }

  async getByOrder(scope: DispatchReadScope, orderId: string) {
    return this.read(
      (db) =>
        db.dispatches.find(
          (item) =>
            item.orderId === orderId &&
            item.tenantId === scope.tenantId &&
            (scope.branchId === undefined || item.branchId === scope.branchId),
        ) ?? null,
    );
  }

  async getPackagesByDispatch(scope: DispatchReadScope, dispatchId: string) {
    return this.read((db) => {
      const dispatch = db.dispatches.find(
        (item) =>
          item.id === dispatchId &&
          item.tenantId === scope.tenantId &&
          (scope.branchId === undefined || item.branchId === scope.branchId),
      );
      if (!dispatch) return [];
      return db.packages.filter((item) => item.dispatchId === dispatch.id);
    });
  }

  async confirm(input: ConfirmDispatchInput): Promise<ConfirmDispatchResult> {
    const operationId = input.operationId.trim();
    if (!operationId) throw new Error("Dispatch operationId is required");
    const carrierName = normalizeOptional(input.carrierName);
    const trackingNumber = normalizeOptional(input.trackingNumber);

    const result = this.store.transact<DispatchMutationResult>((db) => {
      this.assertActor(input, db);
      const order = db.orders.find(
        (item) =>
          item.id === input.orderId &&
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId,
      );
      if (!order)
        throw new Error(`Order not found for authorized dispatch scope: ${input.orderId}`);
      if (order.deliveryMethod !== "home_delivery") {
        throw new Error(`Order delivery method is not dispatchable: ${order.deliveryMethod}`);
      }
      if (![TransportMode.third_party, TransportMode.own_fleet].includes(order.transportMode)) {
        throw new Error(`Order transport mode is not dispatchable: ${order.transportMode}`);
      }
      if (order.transportMode === TransportMode.third_party) {
        if (!carrierName) throw new Error("Third-party dispatch carrierName is required");
        if (!trackingNumber) throw new Error("Third-party dispatch trackingNumber is required");
      }

      const packing = db.packings.find(
        (item) =>
          item.orderId === order.id &&
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId,
      );
      if (
        !packing ||
        packing.status !== PackingStatus.finalized ||
        !packing.finalizedAt ||
        packing.packageCount === undefined ||
        packing.totalWeight === undefined ||
        !packing.labelGenerationId ||
        !packing.labelGeneratedAt ||
        !packing.labelPrintedAt ||
        !packing.labelCode
      ) {
        throw new Error(`Finalized home-delivery Packing not found for Order: ${order.id}`);
      }
      const packages = buildPackagesFromPacking({
        labelCode: packing.labelCode,
        packageCount: packing.packageCount,
      });

      const fingerprint = getDispatchFingerprint({
        tenantId: input.tenantId,
        orderId: order.id,
        transportMode: order.transportMode,
        carrierName,
        trackingNumber,
        packingId: packing.id,
        labelGenerationId: packing.labelGenerationId,
        packageCount: packing.packageCount,
        totalWeight: packing.totalWeight,
      });
      const operationConflict = db.dispatches.find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.confirmationOperationId === operationId &&
          item.orderId !== order.id,
      );
      if (operationConflict) throw new Error(`Dispatch operation conflict: ${operationId}`);

      const matches = db.dispatches.filter(
        (item) => item.tenantId === input.tenantId && item.orderId === order.id,
      );
      if (matches.length > 1) throw new Error(`Duplicate Dispatch records for Order: ${order.id}`);
      let dispatch = matches[0];
      if (dispatch && dispatch.branchId !== input.branchId) {
        throw new Error(`Dispatch branch conflict for Order: ${order.id}`);
      }

      if (dispatch?.confirmationOperationId === operationId) {
        if (dispatch.confirmationFingerprint !== fingerprint) {
          throw new Error(`Dispatch operation conflict: ${operationId}`);
        }
        return { ...this.buildRetryResult(order, dispatch, db), dispatchChanged: false, orderChanged: false, notificationChanged: false };
      }

      if (order.status === OrderStatus.dispatched) {
        if (!dispatch || dispatch.status !== DispatchStatus.dispatched) {
          throw new Error(`Dispatched Order has no canonical Dispatch: ${order.id}`);
        }
        if (!dispatchDataMatches(dispatch, order.transportMode, carrierName, trackingNumber)) {
          throw new Error(`Dispatch data conflict for already dispatched Order: ${order.id}`);
        }
        if (
          !packageDataMatches(
            db.packages.filter((item) => item.dispatchId === dispatch.id),
            packages,
          )
        ) {
          throw new Error(
            `Dispatch Package data conflict for already dispatched Order: ${order.id}`,
          );
        }
        return { ...this.buildRetryResult(order, dispatch, db), dispatchChanged: false, orderChanged: false, notificationChanged: false };
      }
      if (order.status !== OrderStatus.ready_for_dispatch) {
        throw new Error(`Order is not ready for dispatch: ${order.id}`);
      }

      const picking = db.pickingOrders.find(
        (item) =>
          item.orderId === order.id &&
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId,
      );
      if (!picking || picking.status !== PickingStatus.completed) {
        throw new Error(`Picking is not completed for Order: ${order.id}`);
      }
      if (
        db.pickingIncidents.some(
          (incident) =>
            incident.pickingOrderId === picking.id &&
            incident.tenantId === input.tenantId &&
            incident.branchId === input.branchId &&
            incident.status === PickingIncidentStatus.open,
        )
      ) {
        throw new Error(`Picking has unresolved incidents for Order: ${order.id}`);
      }

      const now = this.now();
      const dispatchChanged = true;
      if (!dispatch) {
        dispatch = {
          id: this.id("dispatch"),
          tenantId: input.tenantId,
          branchId: input.branchId,
          orderId: order.id,
          status: DispatchStatus.dispatched,
          transportMode: order.transportMode,
          carrierName,
          trackingNumber,
          dispatchedByUserId: input.actorUserId,
          confirmationOperationId: operationId,
          confirmationFingerprint: fingerprint,
          packageCount: packing.packageCount,
          weight: packing.totalWeight,
          dispatchedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        db.dispatches.push(dispatch);
      } else {
        if (dispatch.status === DispatchStatus.dispatched) {
          throw new Error(`Dispatch state conflict for Order: ${order.id}`);
        }
        Object.assign(dispatch, {
          status: DispatchStatus.dispatched,
          transportMode: order.transportMode,
          carrierName,
          trackingNumber,
          dispatchedByUserId: input.actorUserId,
          confirmationOperationId: operationId,
          confirmationFingerprint: fingerprint,
          packageCount: packing.packageCount,
          weight: packing.totalWeight,
          dispatchedAt: now,
          updatedAt: now,
        });
      }

      const inventoryMovements = commitPickedOrderInventoryInDatabase(db, {
        order, picking, actorUserId: input.actorUserId, operationId,
        referenceType: "dispatch", referenceId: dispatch.id,
        reason: `Despacho de pedido ${order.orderNumber}`,
      }, { id: (prefix) => this.id(prefix), now: () => this.now() });

      db.packages = db.packages.filter((item) => item.dispatchId !== dispatch.id);
      db.packages.push(
        ...packages.map<Package>((item) => ({
          id: this.id("package"),
          dispatchId: dispatch.id,
          number: item.number,
          description: item.description,
          createdAt: now,
        })),
      );
      const persistedPackages = db.packages.filter((item) => item.dispatchId === dispatch.id);
      dispatch.packageCount = packing.packageCount;
      dispatch.weight = packing.totalWeight;

      assertOrderStatusTransition(order.status, OrderStatus.dispatched, "dispatch");
      order.status = OrderStatus.dispatched;
      order.updatedAt = now;
      const notification = this.createNotificationIfApplicable(order, dispatch, db, now);
      const notificationStatus = getNotificationStatus(order.notificationContact);
      return {
        dispatch,
        order,
        notification,
        notificationStatus,
        packages: persistedPackages,
        idempotent: false,
        dispatchChanged,
        orderChanged: true,
        notificationChanged: notification !== undefined,
        inventoryMovements,
      };
    });

    if (result.dispatchChanged) {
      this.emitSafely("dispatch.changed", {
        entityId: result.dispatch.id,
        tenantId: result.dispatch.tenantId,
        branchId: result.dispatch.branchId,
        orderId: result.order.id,
        action: "status_changed",
      });
    }
    if (result.orderChanged) {
      this.emitSafely("order.changed", {
        entityId: result.order.id,
        tenantId: result.order.tenantId,
        branchId: result.order.branchId,
        orderId: result.order.id,
        action: "status_changed",
      });
    }
    result.inventoryMovements?.forEach((movement) => {
      const payload = { entityId: movement.id, tenantId: movement.tenantId,
        branchId: movement.branchId, productId: movement.productId, action: "created" as const };
      this.emitSafely("inventory.changed", payload);
      this.emitSafely("stock.changed", payload);
    });
    if (result.notificationChanged && result.notification) {
      this.emitSafely("notification.changed", {
        entityId: result.notification.id,
        tenantId: result.notification.tenantId,
        branchId: result.dispatch.branchId,
        orderId: result.order.id,
        action: "created",
      });
    }
    return {
      dispatch: result.dispatch,
      order: result.order,
      notification: result.notification,
      notificationStatus: result.notificationStatus,
      packages: result.packages,
      idempotent: result.idempotent,
    };
  }

  async markDelivered(input: MarkDispatchDeliveredInput): Promise<MarkDispatchDeliveredResult> {
    const runtimeInput = input as MarkDispatchDeliveredInput & Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(runtimeInput, "carrierName") ||
      Object.prototype.hasOwnProperty.call(runtimeInput, "trackingNumber") ||
      Object.prototype.hasOwnProperty.call(runtimeInput, "transportMode")
    ) {
      throw new Error("Delivery confirmation cannot modify dispatch shipment data");
    }

    const result = this.store.transact<
      MarkDispatchDeliveredResult & { dispatchChanged: boolean; orderChanged: boolean }
    >((db) => {
      this.assertActor(input, db);
      const order = db.orders.find(
        (item) =>
          item.id === input.orderId &&
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId,
      );
      if (!order) {
        throw new Error(`Order not found for authorized delivery scope: ${input.orderId}`);
      }
      if (order.deliveryMethod !== "home_delivery") {
        throw new Error(
          `Order delivery method cannot be marked delivered: ${order.deliveryMethod}`,
        );
      }

      const matches = db.dispatches.filter(
        (item) => item.tenantId === input.tenantId && item.orderId === order.id,
      );
      if (matches.length !== 1) {
        throw new Error(`Canonical Dispatch not found for delivery: ${order.id}`);
      }
      const dispatch = matches[0];
      if (dispatch.branchId !== input.branchId) {
        throw new Error(`Dispatch branch conflict for delivery: ${order.id}`);
      }

      if (order.status === OrderStatus.delivered || dispatch.status === DispatchStatus.delivered) {
        if (
          order.status === OrderStatus.delivered &&
          dispatch.status === DispatchStatus.delivered &&
          dispatch.deliveredAt
        ) {
          return {
            order,
            dispatch,
            idempotent: true,
            dispatchChanged: false,
            orderChanged: false,
          };
        }
        throw new Error(`Delivery state conflict for Order: ${order.id}`);
      }
      if (order.status !== OrderStatus.dispatched) {
        throw new Error(`Order is not dispatched for delivery: ${order.id}`);
      }
      if (dispatch.status !== DispatchStatus.dispatched) {
        throw new Error(`Dispatch is not dispatched for delivery: ${dispatch.id}`);
      }

      assertOrderStatusTransition(order.status, OrderStatus.delivered, "dispatch");
      const now = this.now();
      order.status = OrderStatus.delivered;
      order.updatedAt = now;
      dispatch.status = DispatchStatus.delivered;
      dispatch.deliveredAt = now;
      dispatch.updatedAt = now;
      return {
        order,
        dispatch,
        idempotent: false,
        dispatchChanged: true,
        orderChanged: true,
      };
    });

    if (result.dispatchChanged) {
      this.emitSafely("dispatch.changed", {
        entityId: result.dispatch.id,
        tenantId: result.dispatch.tenantId,
        branchId: result.dispatch.branchId,
        orderId: result.order.id,
        action: "status_changed",
      });
    }
    if (result.orderChanged) {
      this.emitSafely("order.changed", {
        entityId: result.order.id,
        tenantId: result.order.tenantId,
        branchId: result.order.branchId,
        orderId: result.order.id,
        action: "status_changed",
      });
    }
    return {
      order: result.order,
      dispatch: result.dispatch,
      idempotent: result.idempotent,
    };
  }

  private assertActor(input: { tenantId: string; actorUserId: string }, db: MockDatabase): void {
    const actor = db.users.find(
      (user) =>
        user.id === input.actorUserId &&
        user.tenantId === input.tenantId &&
        user.status === UserStatus.active &&
        user.type === UserType.employee,
    );
    if (!actor) throw new Error(`Dispatch actor not found for tenant: ${input.actorUserId}`);
  }

  private createNotificationIfApplicable(
    order: ConfirmDispatchResult["order"],
    dispatch: Dispatch,
    db: MockDatabase,
    now: string,
  ): Notification | undefined {
    if (order.notificationContact?.emailMode !== "send") return undefined;
    const deduplicationKey = `dispatch-email:${order.tenantId}:${order.id}`;
    const existing = db.notifications.find(
      (item) => item.tenantId === order.tenantId && item.deduplicationKey === deduplicationKey,
    );
    if (existing) throw new Error(`Dispatch notification state conflict for Order: ${order.id}`);
    const carrierText = dispatch.carrierName ? ` Transportista: ${dispatch.carrierName}.` : "";
    const trackingText = dispatch.trackingNumber ? ` Guía: ${dispatch.trackingNumber}.` : "";
    const notification: Notification = {
      id: this.id("notification"),
      tenantId: order.tenantId,
      channel: NotificationChannel.email,
      type: "dispatch_simulated_email",
      title: `Pedido ${order.orderNumber} enviado`,
      message: `Estado: Enviado.${carrierText}${trackingText}`,
      status: NotificationStatus.unread,
      relatedEntityType: "Order",
      relatedEntityId: order.id,
      deliveryStatus: "simulated_sent",
      recipientEmail: order.notificationContact.email,
      orderId: order.id,
      dispatchId: dispatch.id,
      orderReference: order.orderNumber,
      carrierName: dispatch.carrierName,
      trackingNumber: dispatch.trackingNumber,
      deduplicationKey,
      sentAt: now,
      simulatedDeliveryResult: "accepted",
      createdAt: now,
    };
    db.notifications.push(notification);
    return notification;
  }

  private buildRetryResult(
    order: ConfirmDispatchResult["order"],
    dispatch: Dispatch,
    db: MockDatabase,
  ): DispatchMutationResult {
    if (order.status !== OrderStatus.dispatched || dispatch.status !== DispatchStatus.dispatched) {
      throw new Error(`Dispatch retry state conflict for Order: ${order.id}`);
    }
    const notification = db.notifications.find(
      (item) => item.tenantId === order.tenantId && item.dispatchId === dispatch.id,
    );
    if (order.notificationContact?.emailMode === "send" && !notification) {
      throw new Error(`Dispatch simulated notification is missing for Order: ${order.id}`);
    }
    return {
      dispatch,
      order,
      notification,
      notificationStatus: getNotificationStatus(order.notificationContact),
      packages: db.packages.filter((item) => item.dispatchId === dispatch.id),
      idempotent: true,
      dispatchChanged: false,
      orderChanged: false,
      notificationChanged: false,
    };
  }

  private emitSafely(event: DataEventName, payload: DataEventPayload): void {
    try {
      this.emit(event, payload);
    } catch {
      // The authoritative transaction is committed before observers are notified.
    }
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function getDispatchFingerprint(input: {
  tenantId: string;
  orderId: string;
  transportMode: TransportMode;
  carrierName?: string;
  trackingNumber?: string;
  packingId: string;
  labelGenerationId: string;
  packageCount: number;
  totalWeight: number;
}): string {
  return JSON.stringify({
    tenantId: input.tenantId,
    orderId: input.orderId,
    transportMode: input.transportMode,
    carrierName: input.carrierName ?? null,
    trackingNumber: input.trackingNumber ?? null,
    packingId: input.packingId,
    labelGenerationId: input.labelGenerationId,
    packageCount: input.packageCount,
    totalWeight: input.totalWeight,
  });
}

function dispatchDataMatches(
  dispatch: Dispatch,
  transportMode: TransportMode,
  carrierName?: string,
  trackingNumber?: string,
): boolean {
  return (
    dispatch.transportMode === transportMode &&
    normalizeOptional(dispatch.carrierName) === carrierName &&
    normalizeOptional(dispatch.trackingNumber) === trackingNumber
  );
}

function packageDataMatches(
  persisted: Package[],
  requested: Array<{ number: string; weight?: number; description?: string }>,
): boolean {
  return (
    JSON.stringify(
      persisted.map((item) => ({
        number: item.number,
        weight: item.weight ?? null,
        description: item.description ?? null,
      })),
    ) ===
    JSON.stringify(
      requested.map((item) => ({
        number: item.number,
        weight: item.weight ?? null,
        description: item.description ?? null,
      })),
    )
  );
}

function buildPackagesFromPacking(packing: {
  labelCode: string;
  packageCount: number;
}): Array<{ number: string; description: string }> {
  return Array.from({ length: packing.packageCount }, (_, index) => ({
    number: `${packing.labelCode}-${index + 1}`,
    description: `Bulto ${index + 1} de ${packing.packageCount}`,
  }));
}

function getNotificationStatus(
  contact: ConfirmDispatchResult["order"]["notificationContact"],
): DispatchNotificationStatus {
  if (contact?.emailMode === "send") return "simulated_sent";
  if (contact?.emailMode === "not_applicable") return "not_applicable";
  return "legacy_unknown_skipped";
}
