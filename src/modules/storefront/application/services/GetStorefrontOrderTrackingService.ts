import { resolveGuestOrderTracking } from "@/core/orders/resolveGuestOrderTracking";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { StorefrontOrderTrackingDto } from "@/modules/storefront/application/dto/StorefrontOrderTrackingDto";
import { ResolvePublicStorefrontContextService } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";

interface StorefrontOrderTrackingResult {
  orderId: string;
  tracking: StorefrontOrderTrackingDto;
}

/**
 * TRACKING POLICY (auditoría §4, feature/saas-entitlement-enforcement): HISTORICAL ACCESS
 * PRESERVED -- deliberadamente NO llama a `ensurePublicStorefrontTenant` (que exige Subscription/
 * Plan activos + capability `ecommerce`). Un cliente que ya pagó un pedido necesita poder
 * consultarlo aunque el tenant haya bajado de plan, suspendido o cancelado su Subscription
 * DESPUÉS de la compra -- bloquear esto convertiría el fix del catálogo público en una regresión
 * de órdenes históricas. El boundary de seguridad real ya existe y es suficiente:
 * `resolveGuestOrderTracking` exige `EcommerceConfig.enabled` + `guestTrackingEnabled` +
 * `order.source === ecommerce`; además se verifica que `tenantId` corresponda al slug público
 * autoritativo y `orders.getByTrackingToken` scopea por tenant (nunca cross-tenant). Si el negocio
 * quiere bloquear tracking al perder `ecommerce`,
 * requiere una decisión de producto explícita -- no es un default de este guard.
 */
export class GetStorefrontOrderTrackingService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute({ trackingToken, tenantSlug }: { trackingToken: string; tenantSlug: string }): Promise<StorefrontOrderTrackingResult | null> {
    const publicContext = await new ResolvePublicStorefrontContextService(this.repositories)
      .execute({ tenantSlug, allowDisabled: true });
    const order = await this.repositories.orders.getByTrackingToken(publicContext.tenantId, trackingToken);
    if (!order) return null;
    // Guarda compartida (guestTrackingEnabled + canal ecommerce) --
    // ver core/orders/resolveGuestOrderTracking, tambien usada por el
    // widget de soporte (modulo support) para el mismo chip de "estado
    // de mi pedido".
    const view = await resolveGuestOrderTracking(this.repositories, publicContext.tenantId, trackingToken);
    if (!view) return null;

    // Esta pantalla necesita ademas el detalle de items, que
    // resolveGuestOrderTracking no expone (el widget de soporte no lo
    // necesita) -- se vuelve a pedir el pedido completo aca.
    return {
      orderId: view.orderId,
      tracking: {
        orderNumber: view.orderNumber,
        status: view.status,
        total: view.total,
        items: order.items.map((item) => ({
          sku: item.skuSnapshot,
          name: item.nameSnapshot,
          quantity: item.quantity,
          subtotal: item.subtotal,
        })),
      },
    };
  }
}
