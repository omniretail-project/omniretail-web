import type { Product } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ensureCanUpdateProducts,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class RestoreProductService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(productId: string): Promise<Product> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanUpdateProducts(permissions);
    return this.repositories.products.restoreScoped(tenantId, productId);
  }
}
