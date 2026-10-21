import type { ShippingChannelConfig } from "@/core/entities";

/**
 * Valores por defecto mientras el negocio no guarda su configuración de envíos. Son los mismos que
 * aplica el backend (`ShippingConfigService`): ecommerce Q25 con envío gratis desde Q300 y POS sin
 * cobro de envío.
 */
export const DEFAULT_ECOMMERCE_SHIPPING: ShippingChannelConfig = {
  enabled: true,
  deliveryFee: 25,
  freeShippingThreshold: 300,
};

export const DEFAULT_POS_SHIPPING: ShippingChannelConfig = {
  enabled: false,
  deliveryFee: 0,
};

export const SHIPPING_AMOUNT_MAX = 9_999_999_999.99;

/**
 * Costo de envío a domicilio para un subtotal ya descontado. Misma regla que el backend: sin cobro
 * si el canal está desactivado o si el subtotal alcanza el umbral de envío gratis.
 */
export function calculateShippingCost(config: ShippingChannelConfig, subtotal: number): number {
  if (!config.enabled) return 0;
  const threshold = config.freeShippingThreshold;
  if (threshold !== undefined && subtotal >= threshold) return 0;
  return config.deliveryFee;
}
