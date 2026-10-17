import { ApiPurchaseOrderRepository } from "@/infrastructure/api/repositories/ApiPurchaseOrderRepository";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiPurchaseOrders(
  repositories: RepositoryRegistry,
  eventBus: DataEventBus,
): RepositoryRegistry {
  return {
    ...repositories,
    purchaseOrdersDataSource: "api",
    purchaseOrders: new ApiPurchaseOrderRepository(eventBus).withPurchaseOrderDelegate(
      repositories.purchaseOrders,
    ),
  };
}
