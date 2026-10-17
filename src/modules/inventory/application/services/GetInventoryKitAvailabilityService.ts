import type { InventoryKitAvailability } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ensureCanReadStock,
  ensureUserCanOperateInventoryBranch,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";

/**
 * Consulta on-demand (solo API) de la explicacion de disponibilidad de un Kit. El backend es la
 * unica fuente del calculo: aqui no se recalcula nada.
 */
export class GetInventoryKitAvailabilityService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: { kitProductId: string; branchId: string }): Promise<InventoryKitAvailability> {
    const { user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, input.branchId);
    return this.repositories.inventory.getKitAvailability(input);
  }
}
