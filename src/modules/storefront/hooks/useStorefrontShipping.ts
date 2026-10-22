"use client";

import { calculateShippingCost, DEFAULT_ECOMMERCE_SHIPPING } from "@/config/shipping-policy";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

/**
 * Envío estimado del carrito con la tarifa que configuró el negocio. Es solo informativo: el total
 * que se cobra lo recalcula el checkout (backend en modo api, service en modo mock).
 */
export function useStorefrontShipping(subtotal: number) {
  const { config } = usePublicTenant();
  const shipping = config?.shipping ?? DEFAULT_ECOMMERCE_SHIPPING;
  const shippingTotal = calculateShippingCost(shipping, subtotal);

  let hint: string | null = null;
  if (!shipping.enabled) hint = "El envío a domicilio no tiene costo.";
  else if (shippingTotal === 0) hint = "Tu compra tiene envío gratis.";
  else if (shipping.freeShippingThreshold !== undefined) {
    hint = `Envío gratis desde Q${shipping.freeShippingThreshold.toFixed(2)}.`;
  }

  return { shippingTotal, hint };
}
