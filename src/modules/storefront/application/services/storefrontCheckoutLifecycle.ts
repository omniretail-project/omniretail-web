import type { StorefrontCheckoutResultDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";

/**
 * La confirmación vive sólo durante la navegación posterior a un submit.
 * Una instancia nueva de Checkout nunca debe reutilizar el resultado que
 * dejó una compra anterior en el provider público.
 */
export function shouldClearStaleCheckoutConfirmation(
  result: StorefrontCheckoutResultDto | null,
  completedByCurrentCheckout: boolean,
) {
  return Boolean(result && !completedByCurrentCheckout);
}

export function shouldShowCurrentCheckoutConfirmation(
  result: StorefrontCheckoutResultDto | null,
  completedByCurrentCheckout: boolean,
) {
  return Boolean(result && completedByCurrentCheckout);
}
