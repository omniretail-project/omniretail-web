/** Canal de venta al que aplica una tarifa de envío a domicilio. */
export type ShippingChannel = "ecommerce" | "pos";

/**
 * Tarifa de envío a domicilio de un canal. `enabled = false` no cobra envío;
 * `freeShippingThreshold` ausente significa que nunca es gratis.
 */
export interface ShippingChannelConfig {
  enabled: boolean;
  deliveryFee: number;
  freeShippingThreshold?: number;
}

/**
 * Costo de envío por canal del tenant (`/administration/shipping-config`). Es independiente de
 * `EcommerceConfig`: un negocio solo POS también cobra entregas a domicilio.
 */
export interface ShippingConfig {
  tenantId: string;
  ecommerce: ShippingChannelConfig;
  pos: ShippingChannelConfig;
}
