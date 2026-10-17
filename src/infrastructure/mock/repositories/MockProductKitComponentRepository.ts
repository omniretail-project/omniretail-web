import { ProductType } from "@/core/enums";
import type {
  ProductKitComponentRepository,
  ReplaceProductKitComponentInput,
} from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockProductKitComponentRepository
  extends BaseMockRepository
  implements ProductKitComponentRepository
{
  async getByKitProduct(kitProductId: string) {
    return this.read((db) =>
      db.productKitComponents.filter((item) => item.kitProductId === kitProductId),
    );
  }

  async replaceForKit(
    tenantId: string,
    kitProductId: string,
    components: ReplaceProductKitComponentInput[],
  ) {
    const result = this.store.mutate((db) => {
      const kit = db.products.find(
        (item) => item.id === kitProductId && item.tenantId === tenantId,
      );
      if (!kit || kit.productType !== ProductType.kit) throw new Error("Kit product not found");
      if (kit.status === "published" && components.length === 0) {
        throw new Error("A published kit requires at least one component");
      }
      const componentIds = new Set<string>();
      components.forEach((component) => {
        if (!Number.isFinite(component.quantityPerKit) || component.quantityPerKit <= 0) {
          throw new Error("Kit component quantity must be greater than zero");
        }
        if (component.componentProductId === kitProductId)
          throw new Error("A kit cannot include itself");
        if (componentIds.has(component.componentProductId))
          throw new Error("Duplicate kit component");
        componentIds.add(component.componentProductId);
        const product = db.products.find((item) => item.id === component.componentProductId);
        if (
          !product ||
          product.tenantId !== tenantId ||
          product.productType !== ProductType.physical ||
          !product.tracking.stock
        ) {
          throw new Error("Kit components must be tenant physical stock-tracked products");
        }
      });
      db.productKitComponents = db.productKitComponents.filter(
        (item) => item.kitProductId !== kitProductId,
      );
      const now = this.now();
      const created = components.map((component) => ({
        id: this.id("kit-component"),
        tenantId,
        kitProductId,
        componentProductId: component.componentProductId,
        quantityPerKit: component.quantityPerKit,
        createdAt: now,
        updatedAt: now,
      }));
      db.productKitComponents.push(...created);
      return created;
    });
    this.emit("product.changed", {
      entityId: kitProductId,
      tenantId,
      productId: kitProductId,
      action: "updated",
    });
    return result;
  }
}
