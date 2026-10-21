import type { ShippingChannel, ShippingChannelConfig, ShippingConfig } from "@/core/entities";

export type ShippingConfigDto = Omit<ShippingConfig, "tenantId">;

/**
 * Lo que captura el formulario: montos como texto para validar antes de convertir.
 * `freeShippingThreshold` vacío significa "nunca gratis".
 */
export interface ShippingChannelFormValue {
  enabled: boolean;
  deliveryFee: string;
  freeShippingThreshold: string;
}

export type ShippingConfigFormValue = Record<ShippingChannel, ShippingChannelFormValue>;

export type ShippingConfigInputDto = Record<ShippingChannel, ShippingChannelConfig>;
