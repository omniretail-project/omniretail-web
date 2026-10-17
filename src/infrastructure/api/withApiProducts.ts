import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { ApiProductRepository } from "@/infrastructure/api/repositories/ApiProductRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiProducts(
  repositories: RepositoryRegistry,
  eventBus: DataEventBus,
): RepositoryRegistry {
  return {
    ...repositories,
    productDataSource: "api",
    products: new ApiProductRepository(eventBus),
  };
}
