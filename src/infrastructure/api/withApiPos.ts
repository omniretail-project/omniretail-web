import { ApiPosRepository } from "@/infrastructure/api/repositories/ApiPosRepository";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiPos(
  repositories: RepositoryRegistry,
  eventBus: DataEventBus,
): RepositoryRegistry {
  return {
    ...repositories,
    posDataSource: "api",
    posApi: new ApiPosRepository(eventBus),
  };
}
