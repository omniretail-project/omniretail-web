import type { ProductPriceHistoryRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockProductPriceHistoryRepository
  extends BaseMockRepository
  implements ProductPriceHistoryRepository
{
  async getByProduct(productId: string) {
    return this.read((db) =>
      db.productPriceHistory
        .filter((item) => item.productId === productId)
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    );
  }

  async record(input: Parameters<ProductPriceHistoryRepository["record"]>[0]) {
    const item = this.store.mutate((db) => {
      const created = {
        ...input,
        id: this.id("product-price"),
        changedAt: input.changedAt ?? this.now(),
      };
      db.productPriceHistory.push(created);
      return created;
    });
    this.emit("product-price.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      productId: item.productId,
      action: "created",
      previousPrice: item.previousPrice,
      newPrice: item.newPrice,
    });
    return item;
  }
}
