import type { ShippingConfig } from "@/core/entities";
import type { SaveShippingConfigInput, ShippingConfigRepository } from "@/core/repositories";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  type ApiShippingConfig,
  toShippingConfig,
  toShippingConfigRequest,
} from "@/infrastructure/api/apiShippingConfigMapper";
import { backendFetch } from "@/infrastructure/api/backendClient";

const SHIPPING_CONFIG_PATH = "/administration/shipping-config";

/**
 * ShippingConfigRepository de modo api. El backend resuelve el tenant desde el JWT y, sin
 * configuración guardada, ya devuelve los valores por defecto de cada canal.
 */
export class ApiShippingConfigRepository implements ShippingConfigRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async get(tenantId: string): Promise<ShippingConfig> {
    return toShippingConfig(await backendFetch<ApiShippingConfig>(SHIPPING_CONFIG_PATH), tenantId);
  }

  async save(tenantId: string, input: SaveShippingConfigInput): Promise<ShippingConfig> {
    const saved = toShippingConfig(
      await backendFetch<ApiShippingConfig>(SHIPPING_CONFIG_PATH, {
        method: "PUT",
        body: toShippingConfigRequest(input),
      }),
      tenantId,
    );
    this.eventBus.emit("shipping-config.changed", { tenantId });
    return saved;
  }
}
