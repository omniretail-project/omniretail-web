import { ApiPickingRepository } from "@/infrastructure/api/repositories/ApiPickingRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiLogisticsPickingRead(repositories: RepositoryRegistry): RepositoryRegistry {
  const pickingApi = new ApiPickingRepository();
  return {
    ...repositories,
    pickingReadDataSource: "api",
    pickingCommandsEnabled: true,
    pickingRead: pickingApi,
    pickingCommands: pickingApi,
  };
}
