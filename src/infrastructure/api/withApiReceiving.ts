import { ApiReceiptRepository } from "@/infrastructure/api/repositories/ApiReceiptRepository";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export function withApiReceiving(
  repositories: RepositoryRegistry,
  eventBus: DataEventBus,
): RepositoryRegistry {
  return {
    ...repositories,
    receivingDataSource: "api",
    receipts: new ApiReceiptRepository(eventBus).withReceiptDelegate(repositories.receipts),
  };
}
