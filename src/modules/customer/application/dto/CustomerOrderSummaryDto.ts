import type { Order } from "@/core/entities";
import { mapOrderStatusToCustomerStatus, type CustomerOrderStatus } from "@/core/orders/mapOrderStatusToCustomerStatus";
import type { DeliveryMethod } from "@/core/enums";

/**
 * Vista de solo lectura para "Mis pedidos": expone unicamente lo que la
 * pantalla necesita. Order trae campos internos (idempotencyKey/
 * idempotencyFingerprint, branchId, trackingToken, etc.) que no tienen
 * razon de llegar a este boundary de cliente. `deliveryMethod` si viaja
 * -- ya viene en el Order que este mapper recibe, no agrega ningun
 * fetch nuevo.
 */
export interface CustomerOrderSummaryDto {
  id: string;
  orderNumber: string;
  status: CustomerOrderStatus;
  itemCount: number;
  total: number;
  createdAt: string;
  deliveryMethod: DeliveryMethod;
}

export function toCustomerOrderSummaryDto(order: Order): CustomerOrderSummaryDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: mapOrderStatusToCustomerStatus(order.status),
    itemCount: order.items.length,
    total: order.total,
    createdAt: order.createdAt,
    deliveryMethod: order.deliveryMethod,
  };
}
