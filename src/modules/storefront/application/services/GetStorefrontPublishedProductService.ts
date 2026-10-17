import type { Product } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export class GetStorefrontPublishedProductService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, productId: string): Promise<Product | null> {
    const products = await this.repositories.products.getPublishedForEcommerce(tenantId);
    return products.find((product) => product.id === productId) ?? null;
  }
}
