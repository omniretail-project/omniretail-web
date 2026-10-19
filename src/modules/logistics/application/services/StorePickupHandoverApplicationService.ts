import type { StorePickupHandoverResult } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveTrustedDispatchContext } from "@/modules/logistics/application/services/DispatchAuthorizationContext";

const STORE_PICKUP_HANDOVER_CONFIRM = "logistics.dispatch.confirm";

type StorePickupHandoverRepositories = Pick<
  RepositoryRegistry,
  "auth" | "users" | "roles" | "branches" | "storePickupHandoverCommands"
>;

/** Confirms an API store-pickup handover using authority rebuilt from the active session. */
export class StorePickupHandoverApplicationService {
  constructor(private readonly repositories: StorePickupHandoverRepositories) {}

  async confirm(selectedBranchId: string, orderId: string): Promise<StorePickupHandoverResult> {
    assertApiUuid(selectedBranchId, "branchId");
    assertApiUuid(orderId, "orderId");

    const context = await resolveTrustedDispatchContext(
      this.repositories,
      selectedBranchId,
      STORE_PICKUP_HANDOVER_CONFIRM,
    );
    const repository = this.repositories.storePickupHandoverCommands;
    if (!repository) {
      throw new BackendRequestError(
        "El repositorio API de entrega de retiro en tienda no esta configurado.",
        500,
        "STORE_PICKUP_HANDOVER_API_NOT_CONFIGURED",
      );
    }

    return repository.confirm({ branchId: context.branchId }, orderId);
  }
}
