import type { Order } from "@/core/entities";
import { ProductType } from "@/core/enums";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  type InventoryReservationMutationResult,
  releaseInventoryReservationInDatabase,
  reserveOrderItemInDatabase,
} from "@/infrastructure/mock/repositories/inventoryReservationMutations";

interface OrderReservationMutationDependencies {
  id(prefix: string): string;
  now(): string;
}

export function reserveStockTrackedOrderItemsInDatabase(
  order: Order,
  db: MockDatabase,
  dependencies: OrderReservationMutationDependencies,
): InventoryReservationMutationResult[] {
  const itemIds = new Set<string>();

  return order.items.flatMap((orderItem) => {
    if (itemIds.has(orderItem.id)) {
      throw new Error(`Duplicate OrderItem id: ${orderItem.id}`);
    }
    itemIds.add(orderItem.id);

    const product = db.products.find(
      (item) => item.id === orderItem.productId && item.tenantId === order.tenantId,
    );
    if (!product) {
      throw new Error(`Product not found for tenant: ${orderItem.productId}`);
    }
    const demands =
      orderItem.fulfillmentComponents ??
      (product.productType === ProductType.physical && product.tracking.stock
        ? [{
            productId: orderItem.productId,
            quantity: orderItem.inventoryQuantity ?? orderItem.quantity,
          }]
        : []);

    return demands.map((demand) =>
      reserveOrderItemInDatabase(
        db,
        {
          tenantId: order.tenantId,
          branchId: order.branchId,
          orderId: order.id,
          orderItemId: orderItem.id,
          productId: demand.productId,
          quantity: demand.quantity,
        },
        dependencies,
      ),
    );
  });
}

export function releaseOrderReservationsInDatabase(
  order: Order,
  db: MockDatabase,
  dependencies: Pick<OrderReservationMutationDependencies, "now">,
): InventoryReservationMutationResult[] {
  return db.inventoryReservations
    .filter(
      (reservation) => reservation.tenantId === order.tenantId && reservation.orderId === order.id,
    )
    .map((reservation) =>
      releaseInventoryReservationInDatabase(
        db,
        {
          tenantId: order.tenantId,
          branchId: order.branchId,
          reservationId: reservation.id,
        },
        dependencies,
      ),
    );
}
