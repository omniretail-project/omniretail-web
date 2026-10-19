import { ApiStorePickupHandoverRepository } from "@/infrastructure/api/repositories/ApiStorePickupHandoverRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiStorePickupHandover(
  repositories: RepositoryRegistry,
): RepositoryRegistry {
  return {
    ...repositories,
    storePickupHandoverCommands: new ApiStorePickupHandoverRepository(),
  };
}
