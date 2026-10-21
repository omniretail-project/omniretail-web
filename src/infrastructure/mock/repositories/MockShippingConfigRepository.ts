import type { ShippingConfig } from "@/core/entities";
import type { SaveShippingConfigInput, ShippingConfigRepository } from "@/core/repositories";
import { DEFAULT_ECOMMERCE_SHIPPING, DEFAULT_POS_SHIPPING } from "@/config/shipping-policy";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

/**
 * Persiste en MockDatabaseStore para que el carrito, el checkout y el POS en modo mock cobren lo que
 * el administrador configuró. Sin fila del tenant se devuelven los valores por defecto del backend.
 */
export class MockShippingConfigRepository
  extends BaseMockRepository
  implements ShippingConfigRepository
{
  async get(tenantId: string): Promise<ShippingConfig> {
    const saved = this.read((database) =>
      database.shippingConfigs.find((config) => config.tenantId === tenantId),
    );
    return saved ? cloneConfig(saved) : defaultConfig(tenantId);
  }

  async save(tenantId: string, input: SaveShippingConfigInput): Promise<ShippingConfig> {
    const next: ShippingConfig = cloneConfig({ tenantId, ...input });
    this.store.mutate((database) => {
      const index = database.shippingConfigs.findIndex((config) => config.tenantId === tenantId);
      if (index >= 0) database.shippingConfigs[index] = next;
      else database.shippingConfigs.push(next);
    });
    this.emit("shipping-config.changed", { tenantId });
    return cloneConfig(next);
  }
}

function defaultConfig(tenantId: string): ShippingConfig {
  return {
    tenantId,
    ecommerce: { ...DEFAULT_ECOMMERCE_SHIPPING },
    pos: { ...DEFAULT_POS_SHIPPING },
  };
}

function cloneConfig(config: ShippingConfig): ShippingConfig {
  return { tenantId: config.tenantId, ecommerce: { ...config.ecommerce }, pos: { ...config.pos } };
}
