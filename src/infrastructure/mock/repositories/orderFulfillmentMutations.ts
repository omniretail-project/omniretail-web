import type { InventoryReservation, Order, PickingOrder } from "@/core/entities";
import { DeliveryMethod, PickingPriority } from "@/core/enums";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { createPickingOrderInDatabase } from "@/infrastructure/mock/repositories/MockPickingRepository";
import { reserveStockTrackedOrderItemsInDatabase } from "@/infrastructure/mock/repositories/orderReservationMutations";

interface FulfillmentMutationDependencies {
  id(prefix: string): string;
  now(): string;
}

export interface DeferredFulfillmentMutationResult {
  reservationChanges: Array<{ reservation: InventoryReservation; changed: boolean }>;
  pickingOrder?: PickingOrder;
  pickingCreated: boolean;
}

/**
 * Reserves canonical inventory demand and schedules its Picking work in the caller's transaction.
 */
export function scheduleDeferredFulfillmentInTransaction(
  order: Order,
  db: MockDatabase,
  dependencies: FulfillmentMutationDependencies,
): DeferredFulfillmentMutationResult {
  if (order.deliveryMethod === DeliveryMethod.immediate) {
    throw new Error(`Immediate delivery must not schedule Picking: ${order.id}`);
  }

  const reservationChanges = reserveStockTrackedOrderItemsInDatabase(order, db, dependencies);
  const hasPhysicalFulfillment = order.items.some(
    (item) => (item.fulfillmentComponents?.length ?? 0) > 0,
  );
  if (!hasPhysicalFulfillment) {
    return { reservationChanges, pickingCreated: false };
  }

  const picking = createPickingOrderInDatabase(
    db,
    {
      tenantId: order.tenantId,
      branchId: order.branchId,
      orderId: order.id,
      priority: PickingPriority.normal,
    },
    { ...dependencies, canonicalFulfillmentOnly: true },
  );

  return {
    reservationChanges,
    pickingOrder: picking.pickingOrder,
    pickingCreated: picking.created,
  };
}
