import { OrderSource, PaymentStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { StorefrontCheckoutResultDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import { ResolvePublicStorefrontContextService } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";

/**
 * Rebuilds the narrow confirmation view from an opaque tracking token. The
 * token is deliberately resolved only after its public tenant slug, never as
 * a global order lookup.
 */
export class GetStorefrontOrderConfirmationService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute({
    tenantSlug,
    trackingToken,
  }: {
    tenantSlug: string;
    trackingToken: string;
  }): Promise<StorefrontCheckoutResultDto | null> {
    const publicContext = await new ResolvePublicStorefrontContextService(this.repositories)
      .execute({ tenantSlug, allowDisabled: true });
    const order = await this.repositories.orders.getByTrackingToken(
      publicContext.tenantId,
      trackingToken,
    );
    if (!order || order.source !== OrderSource.ecommerce || !order.deliveryAddress) return null;

    const payments = await this.repositories.payments.getByOrder(order.id);
    const payment = payments.find((item) => item.tenantId === publicContext.tenantId);
    if (!payment) return null;

    return {
      orderNumber: order.orderNumber,
      trackingToken: order.trackingToken,
      guestTrackingEnabled: publicContext.ecommerceConfig.guestTrackingEnabled,
      confirmationEmailSent: false,
      total: order.total,
      orderStatus: order.status,
      paymentStatus: payment.status ?? PaymentStatus.pending,
      hasInventoryReservations: order.items.some(
        (item) => (item.fulfillmentComponents?.length ?? 0) > 0,
      ),
      deliveryAddress: {
        recipientName: order.deliveryAddress.recipientName,
        line1: order.deliveryAddress.line1,
        line2: order.deliveryAddress.line2,
        city: order.deliveryAddress.city,
        department: order.deliveryAddress.stateOrDepartment,
        phone: order.deliveryAddress.recipientPhone ?? "",
      },
      items: order.items.map((item) => ({
        sku: item.skuSnapshot,
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
      })),
    };
  }
}
