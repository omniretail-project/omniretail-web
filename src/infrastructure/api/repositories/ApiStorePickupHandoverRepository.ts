import type {
  StorePickupHandoverCommandRepository,
  StorePickupHandoverCommandScope,
} from "@/core/repositories";
import { backendFetch } from "@/infrastructure/api/backendClient";
import { parseStorePickupHandoverResult } from "@/infrastructure/api/repositories/storePickupHandoverApi.schema";
import { assertApiUuid } from "@/infrastructure/api/uuid";

export class ApiStorePickupHandoverRepository
  implements StorePickupHandoverCommandRepository
{
  async confirm(scope: StorePickupHandoverCommandScope, orderId: string) {
    assertApiUuid(scope.branchId, "branchId");
    assertApiUuid(orderId, "orderId");
    return parseStorePickupHandoverResult(
      await backendFetch<unknown>(`/logistics/pickups/${orderId}/handover`, {
        method: "POST",
        query: { branchId: scope.branchId },
      }),
    );
  }
}
