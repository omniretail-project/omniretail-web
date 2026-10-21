import type { ShippingChannelConfig, ShippingConfig } from "@/core/entities";
import type { SaveShippingConfigInput } from "@/core/repositories";
import { DEFAULT_ECOMMERCE_SHIPPING, DEFAULT_POS_SHIPPING } from "@/config/shipping-policy";

/** `ShippingChannelConfigDto` del backend (`/administration/shipping-config`). */
export interface ApiShippingChannelConfig {
  enabled?: boolean | null;
  deliveryFee?: number | string | null;
  freeShippingThreshold?: number | string | null;
}

export interface ApiShippingConfig {
  ecommerce?: ApiShippingChannelConfig | null;
  pos?: ApiShippingChannelConfig | null;
}

export interface ApiShippingChannelConfigRequest {
  enabled: boolean;
  deliveryFee: number;
  freeShippingThreshold: number | null;
}

function toAmount(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

/** Un canal ausente en la respuesta se trata como no configurado (sus valores por defecto). */
export function toShippingChannelConfig(
  response: ApiShippingChannelConfig | null | undefined,
  fallback: ShippingChannelConfig,
): ShippingChannelConfig {
  if (!response) return { ...fallback };
  return {
    enabled: response.enabled === true,
    deliveryFee: toAmount(response.deliveryFee) ?? 0,
    freeShippingThreshold: toAmount(response.freeShippingThreshold),
  };
}

export function toShippingConfig(response: ApiShippingConfig, tenantId: string): ShippingConfig {
  return {
    tenantId,
    ecommerce: toShippingChannelConfig(response.ecommerce, DEFAULT_ECOMMERCE_SHIPPING),
    pos: toShippingChannelConfig(response.pos, DEFAULT_POS_SHIPPING),
  };
}

function toChannelRequest(config: ShippingChannelConfig): ApiShippingChannelConfigRequest {
  return {
    enabled: config.enabled,
    deliveryFee: config.deliveryFee,
    freeShippingThreshold: config.freeShippingThreshold ?? null,
  };
}

export function toShippingConfigRequest(input: SaveShippingConfigInput) {
  return { ecommerce: toChannelRequest(input.ecommerce), pos: toChannelRequest(input.pos) };
}
