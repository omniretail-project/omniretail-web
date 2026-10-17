import { ApiDispatchRepository } from "@/infrastructure/api/repositories/ApiDispatchRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiLogisticsDispatch(repositories: RepositoryRegistry): RepositoryRegistry {
  const dispatchApi = new ApiDispatchRepository();
  return {
    ...repositories,
    dispatchReadDataSource: "api",
    dispatchRead: dispatchApi,
    dispatchCommands: dispatchApi,
  };
}
