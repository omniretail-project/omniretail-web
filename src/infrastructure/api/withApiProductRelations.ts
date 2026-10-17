import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { ApiAttributeRepository } from "@/infrastructure/api/repositories/ApiAttributeRepository";
import { ApiLocationRepository } from "@/infrastructure/api/repositories/ApiLocationRepository";
import { ApiProductKitComponentRepository } from "@/infrastructure/api/repositories/ApiProductKitComponentRepository";
import { ApiProductPriceHistoryRepository } from "@/infrastructure/api/repositories/ApiProductPriceHistoryRepository";
import { ApiProductSalesPriceTierRepository } from "@/infrastructure/api/repositories/ApiProductSalesPriceTierRepository";
import { ApiPromotionRepository } from "@/infrastructure/api/repositories/ApiPromotionRepository";
import { ApiProductMediaRepository } from "@/infrastructure/api/repositories/ApiProductMediaRepository";
import { ApiSupplierProductRepository } from "@/infrastructure/api/repositories/ApiSupplierProductRepository";

export function withApiProductRelations(
  repositories: RepositoryRegistry,
  eventBus: DataEventBus,
): RepositoryRegistry {
  return {
    ...repositories,
    productRelationsDataSource: "api",
    productMediaDataSource: "api",
    productMedia: new ApiProductMediaRepository(repositories.products, eventBus),
    attributes: new ApiAttributeRepository(eventBus),
    inventory: new ApiLocationRepository(eventBus, repositories.products).withInventoryDelegate(
      repositories.inventory,
    ),
    productKitComponents: new ApiProductKitComponentRepository(repositories.products, eventBus),
    productPriceHistory: new ApiProductPriceHistoryRepository(repositories.products),
    productSalesPriceTiers: new ApiProductSalesPriceTierRepository(
      repositories.products,
      eventBus,
    ),
    promotions: new ApiPromotionRepository(repositories.products, eventBus),
    supplierProducts: new ApiSupplierProductRepository(eventBus),
  };
}
