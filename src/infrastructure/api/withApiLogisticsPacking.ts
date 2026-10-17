import { ApiPackingRepository } from "@/infrastructure/api/repositories/ApiPackingRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiLogisticsPacking(repositories: RepositoryRegistry): RepositoryRegistry {
  const packingApi = new ApiPackingRepository();
  return {
    ...repositories,
    packingDataSource: "api",
    packingRead: packingApi,
    packingCommands: packingApi,
  };
}
