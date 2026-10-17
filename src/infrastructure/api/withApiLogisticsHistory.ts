import { ApiLogisticsHistoryRepository } from "@/infrastructure/api/repositories/ApiLogisticsHistoryRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiLogisticsHistory(repositories: RepositoryRegistry): RepositoryRegistry {
  return {
    ...repositories,
    logisticsHistoryDataSource: "api",
    logisticsHistory: new ApiLogisticsHistoryRepository(),
  };
}
