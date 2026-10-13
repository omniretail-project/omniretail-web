import { ApiInventoryTransferRepository } from "@/infrastructure/api/repositories/ApiInventoryTransferRepository";
import { ApiInventoryTransferRequestRepository } from "@/infrastructure/api/repositories/ApiInventoryTransferRequestRepository";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

async function resolveCurrentTenantId(repositories: RepositoryRegistry) {
  const sessionId = await repositories.auth.getCurrentSessionId();
  const session = sessionId ? await repositories.auth.getSession(sessionId) : null;
  const user = session ? await repositories.users.getById(session.userId) : null;
  if (!user) throw new Error("No se pudo resolver el tenant de la sesión actual.");
  return user.tenantId;
}

export function withApiInventoryTransfers(
  repositories: RepositoryRegistry,
  eventBus: DataEventBus,
): RepositoryRegistry {
  const resolveTenantId = () => resolveCurrentTenantId(repositories);
  return {
    ...repositories,
    inventoryTransfersDataSource: "api",
    inventoryTransfers: new ApiInventoryTransferRepository(
      eventBus,
      resolveTenantId,
    ).withTransferDelegate(repositories.inventoryTransfers),
    inventoryTransferRequests: new ApiInventoryTransferRequestRepository(
      eventBus,
      resolveTenantId,
    ).withRequestDelegate(repositories.inventoryTransferRequests),
  };
}
