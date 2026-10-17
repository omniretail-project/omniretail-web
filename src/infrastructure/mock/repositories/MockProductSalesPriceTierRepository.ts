import type { ProductSalesPriceTierRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockProductSalesPriceTierRepository
  extends BaseMockRepository
  implements ProductSalesPriceTierRepository
{
  async getByProduct(productId: string) {
    return this.read((db) =>
      db.productSalesPriceTiers
        .filter((item) => item.productId === productId)
        .sort((a, b) => a.minQuantity - b.minQuantity),
    );
  }

  async replaceForProduct(
    productId: string,
    tiers: Parameters<ProductSalesPriceTierRepository["replaceForProduct"]>[1],
  ) {
    this.assertValidTiers(tiers);
    const items = this.store.mutate((db) => {
      const product = db.products.find((item) => item.id === productId);
      if (!product) throw this.missing("Product", productId);
      tiers.forEach((tier) => {
        if (tier.tenantId !== product.tenantId) {
          throw new Error("Product sales price tier tenant must match product tenant");
        }
      });
      db.productSalesPriceTiers = db.productSalesPriceTiers.filter(
        (item) => item.productId !== productId,
      );
      const now = this.now();
      const created = tiers
        .map((tier) => ({
          ...tier,
          productId,
          id: this.id("product-sales-price-tier"),
          createdAt: now,
          updatedAt: now,
        }))
        .sort((a, b) => a.minQuantity - b.minQuantity);
      db.productSalesPriceTiers.push(...created);
      return created;
    });
    this.emit("product-sales-price-tier.changed", {
      productId,
      tenantId: items[0]?.tenantId,
      action: "updated",
    });
    return items;
  }

  private assertValidTiers(
    tiers: Parameters<ProductSalesPriceTierRepository["replaceForProduct"]>[1],
  ): void {
    const quantities = new Set<number>();
    for (const tier of tiers) {
      if (tier.minQuantity <= 1) {
        throw new Error("Product sales price tier minQuantity must be greater than 1");
      }
      if (tier.unitPrice <= 0) {
        throw new Error("Product sales price tier unitPrice must be greater than 0");
      }
      if (quantities.has(tier.minQuantity)) {
        throw new Error("Product sales price tier minQuantity must be unique per product");
      }
      quantities.add(tier.minQuantity);
    }
  }
}
