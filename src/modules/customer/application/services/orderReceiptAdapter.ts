import { OrderStatus, PaymentStatus } from "@/core/enums";
import type { StorefrontCheckoutResultDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import type { CustomerOrderDetailDto } from "@/modules/customer/application/dto/CustomerOrderDetailDto";

/**
 * Adapta CustomerOrderDetailDto (ya resuelto y autorizado por
 * getCurrentCustomerOrderDetail -- ver orderService.ts) a la forma que
 * espera downloadStorefrontReceiptPdf (Storefront/Maria). NO se
 * duplica la plantilla del PDF ni se crea un segundo generador: se
 * reutiliza tal cual, solo se remodela el dato de entrada.
 *
 * guestTrackingEnabled/confirmationEmailSent/hasInventoryReservations
 * son campos propios del flujo de checkout que el generador de PDF no
 * lee en ningun momento (son parte de StorefrontCheckoutResultDto por
 * el contexto donde se creo ese tipo) -- se completan con un valor
 * fijo solo para satisfacer el tipo, sin efecto en el comprobante
 * generado.
 */
export function toReceiptInput(order: CustomerOrderDetailDto): StorefrontCheckoutResultDto {
  return {
    orderNumber: order.orderNumber,
    trackingToken: order.trackingToken,
    guestTrackingEnabled: true,
    confirmationEmailSent: true,
    total: order.total,
    orderStatus: order.status === "sent" ? OrderStatus.dispatched : order.status,
    paymentStatus: (order.payment?.status as PaymentStatus | undefined) ?? PaymentStatus.pending,
    hasInventoryReservations: false,
    deliveryAddress: order.deliveryAddress
      ? {
          recipientName: order.deliveryAddress.recipientName,
          line1: order.deliveryAddress.line1,
          line2: order.deliveryAddress.line2,
          city: order.deliveryAddress.city,
          department: order.deliveryAddress.department,
          phone: order.deliveryAddress.recipientPhone ?? "",
        }
      : {
          recipientName: "-",
          line1: "Sin entrega a domicilio",
          city: "-",
          phone: "",
        },
    items: order.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
    })),
  };
}
