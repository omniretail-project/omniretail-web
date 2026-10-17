import type { SupplierProductRepository } from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { synchronizeSupplierLeadTimeDays } from "@/infrastructure/mock/database/supplierLeadTime";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockSupplierProductRepository
  extends BaseMockRepository
  implements SupplierProductRepository
{
  async getByProduct(productId: string) {
    return this.read((db) =>
      db.supplierProducts
        .filter((item) => item.productId === productId && item.active)
        .sort((a, b) => Number(b.preferred) - Number(a.preferred)),
    );
  }

  async getByProductForTenant(tenantId: string, productId: string) {
    return this.read((db) =>
      db.supplierProducts
        .filter((item) => item.productId === productId && item.tenantId === tenantId && item.active)
        .sort((a, b) => Number(b.preferred) - Number(a.preferred)),
    );
  }

  async getAllByProductForTenant(tenantId: string, productId: string) {
    return this.read((db) =>
      db.supplierProducts
        .filter((item) => item.productId === productId && item.tenantId === tenantId)
        .sort((a, b) => Number(b.preferred) - Number(a.preferred)),
    );
  }

  async getBySupplier(supplierId: string) {
    return this.read((db) =>
      db.supplierProducts.filter((item) => item.supplierId === supplierId && item.active),
    );
  }

  async getBySupplierForTenant(tenantId: string, supplierId: string) {
    return this.read((db) =>
      db.supplierProducts.filter(
        (item) => item.supplierId === supplierId && item.tenantId === tenantId && item.active,
      ),
    );
  }

  async create(input: Parameters<SupplierProductRepository["create"]>[0]) {
    this.assertValidSupplierProduct(input);
    const item = this.store.mutate((db) => {
      this.assertReferences(input, db);
      if (input.preferred) {
        db.supplierProducts.forEach((supplierProduct) => {
          if (supplierProduct.productId === input.productId) {
            supplierProduct.preferred = false;
          }
        });
      }
      const now = this.now();
      const created = { ...input, id: this.id("supplier-product"), createdAt: now, updatedAt: now };
      db.supplierProducts.push(created);
      synchronizeSupplierLeadTimeDays(db, [created.supplierId]);
      return created;
    });
    this.emit("supplier-product.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      productId: item.productId,
      action: "created",
    });
    return item;
  }

  async update(
    tenantId: string,
    id: string,
    input: Parameters<SupplierProductRepository["update"]>[2],
  ) {
    const item = this.store.mutate((db) => {
      const current = db.supplierProducts.find(
        (supplierProduct) => supplierProduct.id === id && supplierProduct.tenantId === tenantId,
      );
      if (!current) throw this.missing("SupplierProduct", id);
      const next = { ...current, ...input };
      this.assertValidSupplierProduct(next);
      this.assertReferences(next, db);
      if (next.preferred) {
        db.supplierProducts.forEach((supplierProduct) => {
          if (supplierProduct.productId === next.productId && supplierProduct.id !== id) {
            supplierProduct.preferred = false;
          }
        });
      }
      const updated = this.updateById(db.supplierProducts, id, input, "SupplierProduct");
      synchronizeSupplierLeadTimeDays(db, [current.supplierId, updated.supplierId]);
      return updated;
    });
    this.emit("supplier-product.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      productId: item.productId,
      action: "updated",
    });
    return item;
  }

  async archive(tenantId: string, id: string) {
    const item = this.store.mutate((db) => {
      const current = db.supplierProducts.find(
        (supplierProduct) => supplierProduct.id === id && supplierProduct.tenantId === tenantId,
      );
      if (!current) throw this.missing("SupplierProduct", id);
      const archived = this.updateById(
        db.supplierProducts,
        id,
        { active: false },
        "SupplierProduct",
      );
      synchronizeSupplierLeadTimeDays(db, [archived.supplierId]);
      return archived;
    });
    this.emit("supplier-product.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      productId: item.productId,
      action: "archived",
    });
    return item;
  }

  async setPreferred(tenantId: string, productId: string, supplierProductId: string) {
    const item = this.store.mutate((db) => {
      const selected = db.supplierProducts.find(
        (supplierProduct) =>
          supplierProduct.id === supplierProductId &&
          supplierProduct.productId === productId &&
          supplierProduct.tenantId === tenantId &&
          supplierProduct.active,
      );
      if (!selected) throw this.missing("SupplierProduct", supplierProductId);
      db.supplierProducts.forEach((supplierProduct) => {
        if (supplierProduct.productId === productId) {
          supplierProduct.preferred = supplierProduct.id === supplierProductId;
          supplierProduct.updatedAt = this.now();
        }
      });
      return selected;
    });
    this.emit("supplier-product.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      productId,
      action: "updated",
    });
    return item;
  }

  async getCostTiers(supplierProductId: string) {
    return this.read((db) =>
      db.supplierCostTiers
        .filter((item) => item.supplierProductId === supplierProductId)
        .sort((a, b) => a.minQuantity - b.minQuantity),
    );
  }

  async replaceCostTiers(
    tenantId: string,
    supplierProductId: string,
    tiers: Parameters<SupplierProductRepository["replaceCostTiers"]>[2],
  ) {
    this.assertValidCostTiers(tiers);
    const items = this.store.mutate((db) => {
      const supplierProduct = db.supplierProducts.find(
        (item) => item.id === supplierProductId && item.tenantId === tenantId,
      );
      if (!supplierProduct) throw this.missing("SupplierProduct", supplierProductId);
      tiers.forEach((tier) => {
        if (tier.tenantId !== supplierProduct.tenantId) {
          throw new Error("Supplier cost tier tenant must match SupplierProduct tenant");
        }
      });
      db.supplierCostTiers = db.supplierCostTiers.filter(
        (item) => item.supplierProductId !== supplierProductId,
      );
      const created = tiers
        .map((tier) => ({
          ...tier,
          supplierProductId,
          id: this.id("supplier-cost-tier"),
        }))
        .sort((a, b) => a.minQuantity - b.minQuantity);
      db.supplierCostTiers.push(...created);
      return created;
    });
    this.emit("supplier-product.changed", {
      entityId: supplierProductId,
      tenantId: items[0]?.tenantId,
      action: "updated",
    });
    return items;
  }

  private assertValidSupplierProduct(
    supplierProduct: Parameters<SupplierProductRepository["create"]>[0],
  ): void {
    if (supplierProduct.purchaseToBaseFactor <= 0) {
      throw new Error("SupplierProduct purchaseToBaseFactor must be greater than 0");
    }
    if (supplierProduct.lastCost < 0) {
      throw new Error("SupplierProduct lastCost must be greater than or equal to 0");
    }
    if (supplierProduct.minimumOrderQuantity <= 0) {
      throw new Error("SupplierProduct minimumOrderQuantity must be greater than 0");
    }
    if (supplierProduct.leadTimeDays < 0) {
      throw new Error("SupplierProduct leadTimeDays must be greater than or equal to 0");
    }
  }

  private assertReferences(
    supplierProduct: Parameters<SupplierProductRepository["create"]>[0],
    db: MockDatabase,
  ): void {
    const product = db.products.find((item) => item.id === supplierProduct.productId);
    if (!product) throw this.missing("Product", supplierProduct.productId);
    const supplier = db.suppliers.find((item) => item.id === supplierProduct.supplierId);
    if (!supplier) throw this.missing("Supplier", supplierProduct.supplierId);
    if (
      product.tenantId !== supplierProduct.tenantId ||
      supplier.tenantId !== supplierProduct.tenantId
    ) {
      throw new Error("SupplierProduct tenant must match product and supplier tenant");
    }
  }

  private assertValidCostTiers(
    tiers: Parameters<SupplierProductRepository["replaceCostTiers"]>[2],
  ): void {
    const quantities = new Set<number>();
    for (const tier of tiers) {
      if (tier.minQuantity <= 0) {
        throw new Error("Supplier cost tier minQuantity must be greater than 0");
      }
      if (tier.unitCost < 0) {
        throw new Error("Supplier cost tier unitCost must be greater than or equal to 0");
      }
      if (quantities.has(tier.minQuantity)) {
        throw new Error("Supplier cost tier minQuantity must be unique per SupplierProduct");
      }
      quantities.add(tier.minQuantity);
    }
  }
}
