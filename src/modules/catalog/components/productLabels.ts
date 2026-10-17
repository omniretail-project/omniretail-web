import { ProductType } from "@/core/enums";
import type { ProductChannels } from "@/core/entities/Product";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";

export const productTypeLabels: Record<ProductType, string> = {
  [ProductType.physical]: "Físico",
  [ProductType.service]: "Servicio",
  [ProductType.kit]: "Kit",
};

export function formatChannels(channels: ProductChannels) {
  const enabled = [
    channels.pos ? "POS" : null,
    channels.ecommerce ? "Web" : null,
    channels.mobileApp ? "App" : null,
  ].filter(Boolean);
  return enabled.length ? enabled.join(" + ") : "Sin canales";
}

export function formatTracking(tracking: ProductTrackingConfig) {
  const enabled = [
    tracking.stock ? "Stock" : null,
    tracking.lot ? "Lotes" : null,
    tracking.expiration ? "Vencimiento" : null,
    tracking.serial ? "Series" : null,
  ].filter(Boolean);
  return enabled.length ? enabled.join(" + ") : "Sin trazabilidad";
}
