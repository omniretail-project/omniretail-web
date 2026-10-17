import type { Promotion } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetProductDetailService } from "@/modules/catalog/application/services/GetProductDetailService";
import type { ProductDetailViewModel } from "@/modules/catalog/types/catalog.types";
import {
  ensureCanReadPromotions,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export interface ProductPromotionsViewModel extends ProductDetailViewModel {
  promotions: Promotion[];
}

export class GetProductPromotionsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(productId: string): Promise<ProductPromotionsViewModel | null> {
    const { permissions } = await resolveTenantContext(this.repositories);
    if (this.repositories.productRelationsDataSource === "api") {
      ensureCanReadPromotions(permissions);
    }
    const detail = await new GetProductDetailService(this.repositories).execute(productId);
    if (!detail) return null;
    const promotions = await this.repositories.promotions.getByProductScoped(
      detail.product.tenantId,
      productId,
    );

    return {
      ...detail,
      promotions: promotions.sort((left, right) => right.startAt.localeCompare(left.startAt)),
    };
  }
}
