import type { OtherBranchAvailability } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ensureCanReadStock,
  ensureUserCanOperateInventoryBranch,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";

/** Consulta on-demand (solo API) de la disponibilidad del producto en otras sucursales. */
export class InventoryOtherBranchesService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: { productId: string; branchId: string }): Promise<OtherBranchAvailability[]> {
    const { user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, input.branchId);
    return this.repositories.inventory.getOtherBranchesAvailability(input);
  }
}
