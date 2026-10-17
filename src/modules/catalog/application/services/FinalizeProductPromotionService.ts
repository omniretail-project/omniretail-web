import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ensureCanManagePromotions,
  ensureCanUpdateProducts,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class FinalizeProductPromotionService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(promotionId: string) {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    if (this.repositories.productRelationsDataSource === "api") {
      ensureCanManagePromotions(permissions);
    } else {
      ensureCanUpdateProducts(permissions);
    }
    return this.repositories.promotions.endScoped(tenantId, promotionId);
  }
}
