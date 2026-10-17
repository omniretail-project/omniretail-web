import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ApiInventoryMovementRepository } from "@/infrastructure/api/repositories/ApiInventoryMovementRepository";

export function withApiInventoryMovements(
  repositories: RepositoryRegistry,
): RepositoryRegistry {
  return {
    ...repositories,
    inventoryMovementsDataSource: "api",
    inventory: new ApiInventoryMovementRepository().withInventoryDelegate(
      repositories.inventory,
    ),
  };
}
