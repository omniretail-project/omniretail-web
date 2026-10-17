import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { ApiCategoryRepository } from "@/infrastructure/api/repositories/ApiCategoryRepository";
import { ApiLocationRepository } from "@/infrastructure/api/repositories/ApiLocationRepository";
import { ApiUnitRepository } from "@/infrastructure/api/repositories/ApiUnitRepository";

export function withApiCatalogMasterData(
  repositories: RepositoryRegistry,
  eventBus: DataEventBus,
): RepositoryRegistry {
  return {
    ...repositories,
    categories: new ApiCategoryRepository(eventBus),
    inventory: new ApiLocationRepository(eventBus).withInventoryDelegate(repositories.inventory),
    units: new ApiUnitRepository(repositories.units, eventBus),
  };
}
