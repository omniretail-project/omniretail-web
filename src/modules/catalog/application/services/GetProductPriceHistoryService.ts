import type { ProductPriceHistory } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetProductDetailService } from "@/modules/catalog/application/services/GetProductDetailService";
import type { ProductDetailViewModel } from "@/modules/catalog/types/catalog.types";

export interface ProductPriceHistoryViewModel extends ProductDetailViewModel {
  history: ProductPriceHistory[];
}

export class GetProductPriceHistoryService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(productId: string): Promise<ProductPriceHistoryViewModel | null> {
    const detail = await new GetProductDetailService(this.repositories).execute(productId);
    if (!detail) return null;
    const history = await this.repositories.productPriceHistory.getByProduct(productId);

    return {
      ...detail,
      history,
    };
  }
}
