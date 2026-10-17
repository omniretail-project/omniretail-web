import type { EcommerceConfig } from "@/core/entities";
import type { EcommerceConfigDto } from "@/modules/administration/application/dto/EcommerceConfigDto";

export function toEcommerceConfigDto(config: EcommerceConfig): EcommerceConfigDto {
  return {
    enabled: config.enabled,
    storeName: config.storeName,
    logo: config.logo,
    contactPhone: config.contactPhone,
    contactEmail: config.contactEmail,
    requireAccountForCheckout: config.requireAccountForCheckout,
    guestTrackingEnabled: config.guestTrackingEnabled,
    allowedDeliveryMethods: [...config.allowedDeliveryMethods],
    allowedPaymentMethods: [...config.allowedPaymentMethods],
    defaultBranchId: config.defaultBranchId,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}
