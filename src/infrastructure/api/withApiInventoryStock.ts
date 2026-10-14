import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ApiInventoryAdjustmentRepository } from "@/infrastructure/api/repositories/ApiInventoryAdjustmentRepository";
import { ApiLocationRepository } from "@/infrastructure/api/repositories/ApiLocationRepository";
import { ApiInventoryStockRepository } from "@/infrastructure/api/repositories/ApiInventoryStockRepository";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";

export function withApiInventoryStock(
  repositories: RepositoryRegistry,
  eventBus: DataEventBus,
): RepositoryRegistry {
  // ApiLocationRepository ya cubre ubicaciones. Al inyectarle Products API también puede resolver
  // ProductInventorySettings/defaultLocationId desde Backend, sin caer al delegado mock.
  const inventoryWithStock = new ApiInventoryStockRepository(eventBus).withInventoryDelegate(
    repositories.inventory,
  );
  return {
    ...repositories,
    inventoryStockDataSource: "api",
    inventory: new ApiLocationRepository(eventBus, repositories.products).withInventoryDelegate(
      inventoryWithStock,
    ),
    inventoryAdjustments: new ApiInventoryAdjustmentRepository(eventBus).withAdjustmentDelegate(
      repositories.inventoryAdjustments,
    ),
  };
}
