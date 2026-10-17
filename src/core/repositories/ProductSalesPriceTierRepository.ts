import type { ProductSalesPriceTier } from "@/core/entities";

export interface ProductSalesPriceTierRepository {
  getByProduct(productId: string): Promise<ProductSalesPriceTier[]>;
  replaceForProduct(
    productId: string,
    tiers: Omit<ProductSalesPriceTier, "id" | "productId" | "createdAt" | "updatedAt">[],
  ): Promise<ProductSalesPriceTier[]>;
}
