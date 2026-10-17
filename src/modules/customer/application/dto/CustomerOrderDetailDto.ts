import type { Order, Payment } from "@/core/entities";
import { mapOrderStatusToCustomerStatus, type CustomerOrderStatus } from "@/core/orders/mapOrderStatusToCustomerStatus";

export interface CustomerOrderDetailDto {
  orderNumber: string;
  status: CustomerOrderStatus;
  createdAt: string;
  trackingToken: string;
  subtotal: number;
  shippingTotal: number;
  total: number;
  deliveryAddress?: {
    recipientName: string;
    recipientPhone?: string;
    line1: string;
    line2?: string;
    city: string;
    department?: string;
    country: string;
    references?: string;
  };
  items: Array<{ sku: string; name: string; quantity: number; unitPrice: number; subtotal: number }>;
  payment: { method: string; status: string; reference?: string } | null;
}

export function toCustomerOrderDetailDto(order: Order, payment?: Payment): CustomerOrderDetailDto {
  return {
    orderNumber: order.orderNumber,
    status: mapOrderStatusToCustomerStatus(order.status),
    createdAt: order.createdAt,
    trackingToken: order.trackingToken,
    subtotal: order.subtotal,
    shippingTotal: order.shippingTotal,
    total: order.total,
    deliveryAddress: order.deliveryAddress
      ? {
          recipientName: order.deliveryAddress.recipientName,
          recipientPhone: order.deliveryAddress.recipientPhone,
          line1: order.deliveryAddress.line1,
          line2: order.deliveryAddress.line2,
          city: order.deliveryAddress.city,
          department: order.deliveryAddress.stateOrDepartment,
          country: order.deliveryAddress.country,
          references: order.deliveryAddress.references,
        }
      : undefined,
    items: order.items.map((item) => ({
      sku: item.skuSnapshot,
      name: item.nameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
    })),
    payment: payment
      ? {
          method: payment.method === "card" ? "Tarjeta de crédito o débito" : payment.method,
          status: payment.status,
          reference: payment.reference?.match(/(\d{4})$/)?.[1]
            ? `•••• ${payment.reference.match(/(\d{4})$/)![1]}`
            : undefined,
        }
      : null,
  };
}
