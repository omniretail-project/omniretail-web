import { OrderSource } from "@/core/enums";
import { mapOrderStatusToCustomerStatus, type CustomerOrderStatus } from "@/core/orders/mapOrderStatusToCustomerStatus";
import type { BusinessConfigRepository, OrderRepository } from "@/core/repositories";

export interface GuestOrderTrackingView {
  orderId: string;
  orderNumber: string;
  status: CustomerOrderStatus;
  total: number;
}

/**
 * Regla compartida de seguimiento de pedido para invitados/publico: solo
 * responde si el tenant tiene EcommerceConfig.guestTrackingEnabled y el
 * pedido es de canal ecommerce (OrderSource.ecommerce) -- nunca expone
 * pedidos de POS ni de un tenant con el seguimiento deshabilitado.
 *
 * Extraida de GetStorefrontOrderTrackingService (modulo storefront, de
 * Maria) para que el widget de soporte (modulo support) pueda reproducir
 * EXACTAMENTE la misma regla sin importar la capa interna de storefront
 * (eso cruzaria la propiedad de otro modulo) ni duplicar la condicion a
 * mano en dos lugares que podrian desincronizarse. Vive en core/ (sin
 * dueño de modulo) porque ninguno de los dos la posee en exclusiva --
 * ambos la consumen.
 */
export async function resolveGuestOrderTracking(
  repositories: { orders: OrderRepository; businessConfig: BusinessConfigRepository },
  tenantId: string,
  trackingToken: string,
): Promise<GuestOrderTrackingView | null> {
  const [config, order] = await Promise.all([
    repositories.businessConfig.getEcommerceConfig(tenantId),
    repositories.orders.getByTrackingToken(tenantId, trackingToken),
  ]);

  if (!config?.enabled || !config.guestTrackingEnabled) return null;
  if (!order || order.source !== OrderSource.ecommerce) return null;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: mapOrderStatusToCustomerStatus(order.status),
    total: order.total,
  };
}
