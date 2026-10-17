import { ecommercePaymentPolicy } from "@/config/ecommerce-payment-policy";
import { DeliveryMethod } from "@/core/enums";
import type { EcommerceConfigInputDto } from "@/modules/administration/application/dto/EcommerceConfigDto";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import {
  ADMIN_FIELD_LIMITS,
  isValidGuatemalaPhone,
  normalizeGuatemalaPhone,
} from "@/modules/administration/validation/adminFieldConstraints";

/**
 * Web/App tienen una política fija de pago y entrega (tarjeta + envío a domicilio): no es una
 * decisión editable desde el formulario. Se fuerza acá, sin importar lo que traiga el payload, para
 * que ningún consumidor directo pueda persistir otro método. `PaymentMethod`/`DeliveryMethod` no se
 * tocan como enums: POS sigue usando el resto de sus valores para sus propios escenarios.
 */
const FIXED_ALLOWED_DELIVERY_METHODS = [DeliveryMethod.home_delivery];
const LIMITS = ADMIN_FIELD_LIMITS.ecommerceConfig;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEcommerceConfigInput(dto: EcommerceConfigInputDto) {
  if (!dto.storeName.trim()) {
    throw new AdministrationServiceError("El nombre de la tienda es obligatorio.");
  }
  if (dto.storeName.trim().length > LIMITS.storeName) {
    throw new AdministrationServiceError("El nombre de la tienda no puede exceder 120 caracteres.");
  }
  const contactEmail = dto.contactEmail?.trim();
  if (
    contactEmail &&
    (contactEmail.length > LIMITS.contactEmail || !EMAIL_PATTERN.test(contactEmail))
  ) {
    throw new AdministrationServiceError("El correo publico de contacto no es valido.");
  }
  const contactPhone = dto.contactPhone?.trim();
  if (contactPhone && !isValidGuatemalaPhone(contactPhone)) {
    throw new AdministrationServiceError("El teléfono público debe tener 8 dígitos.");
  }
  if (dto.defaultBranchId !== undefined && !dto.defaultBranchId.trim()) {
    throw new AdministrationServiceError("La sucursal predeterminada no es válida.");
  }
}

export function normalizeEcommerceConfigInput(
  dto: EcommerceConfigInputDto,
): EcommerceConfigInputDto {
  const defaultBranchId = dto.defaultBranchId?.trim();

  return {
    enabled: dto.enabled,
    storeName: dto.storeName.trim(),
    logo: dto.logo,
    pendingLogo: dto.pendingLogo,
    removeLogo: dto.removeLogo,
    contactPhone: dto.contactPhone?.trim() ? normalizeGuatemalaPhone(dto.contactPhone) : undefined,
    contactEmail: dto.contactEmail?.trim().toLowerCase() || undefined,
    requireAccountForCheckout: dto.requireAccountForCheckout,
    guestTrackingEnabled: dto.guestTrackingEnabled,
    allowedDeliveryMethods: [...FIXED_ALLOWED_DELIVERY_METHODS],
    allowedPaymentMethods: [...ecommercePaymentPolicy.allowedMethods],
    defaultBranchId: defaultBranchId || undefined,
  };
}
