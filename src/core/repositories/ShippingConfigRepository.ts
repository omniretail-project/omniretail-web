import type { ShippingChannelConfig, ShippingConfig } from "@/core/entities";

export interface SaveShippingConfigInput {
  ecommerce: ShippingChannelConfig;
  pos: ShippingChannelConfig;
}

/**
 * Costo de envío por canal. El backend resuelve el tenant desde el JWT: `tenantId` solo etiqueta la
 * respuesta y nunca se envía.
 */
export interface ShippingConfigRepository {
  /** Siempre devuelve un valor; sin configuración guardada, los valores por defecto de cada canal. */
  get(tenantId: string): Promise<ShippingConfig>;
  save(tenantId: string, input: SaveShippingConfigInput): Promise<ShippingConfig>;
}
