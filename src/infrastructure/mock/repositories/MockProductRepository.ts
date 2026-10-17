import { ProductStatus, ProductType, SalesChannel, UnitCategory } from "@/core/enums";
import type { ProductRepository } from "@/core/repositories";
import { normalizeSku } from "@/shared/utils/normalizeSku";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockProductRepository extends BaseMockRepository implements ProductRepository {
  async getAll() {
    return this.read((db) => db.products);
  }
  async getByTenant(tenantId: string) {
    return this.read((db) => db.products.filter((item) => item.tenantId === tenantId));
  }
  async getById(id: string) {
    return this.read((db) => db.products.find((item) => item.id === id) ?? null);
  }
  async getByIdScoped(tenantId: string, id: string) {
    return this.read(
      (db) => db.products.find((item) => item.id === id && item.tenantId === tenantId) ?? null,
    );
  }
  async getBySku(sku: string) {
    const normalizedSku = normalizeSku(sku);
    return this.read((db) => db.products.find((item) => item.sku === normalizedSku) ?? null);
  }
  async getBySkuScoped(tenantId: string, sku: string) {
    const normalizedSku = normalizeSku(sku);
    return this.read(
      (db) =>
        db.products.find((item) => item.tenantId === tenantId && item.sku === normalizedSku) ??
        null,
    );
  }
  async getPageScoped(
    tenantId: string,
    params: Parameters<ProductRepository["getPageScoped"]>[1],
  ) {
    const products = await this.getByTenant(tenantId);
    const [field = "name", direction = "asc"] = (params.sort ?? "name,asc").split(",");
    const sorted = [...products].sort((left, right) => {
      const leftValue = String(left[field as "name" | "sku" | "createdAt"]);
      const rightValue = String(right[field as "name" | "sku" | "createdAt"]);
      const comparison = leftValue.localeCompare(rightValue) || left.id.localeCompare(right.id);
      return direction === "desc" ? -comparison : comparison;
    });
    const start = (params.page - 1) * params.pageSize;
    return {
      items: sorted.slice(start, start + params.pageSize),
      page: params.page,
      pageSize: params.pageSize,
      totalItems: sorted.length,
      totalPages: Math.ceil(sorted.length / params.pageSize),
    };
  }
  async getPublishedForEcommerce(tenantId: string) {
    const products = await this.getPublishedForChannel(SalesChannel.ecommerce);
    return products.filter((product) => product.tenantId === tenantId);
  }
  async getAvailableForPos() {
    return this.getPublishedForChannel(SalesChannel.pos);
  }
  async getPublishedForChannel(channel: SalesChannel) {
    return this.read((db) =>
      db.products.filter(
        (item) => item.status === ProductStatus.published && item.channels[channel],
      ),
    );
  }
  async create(input: Parameters<ProductRepository["create"]>[0]) {
    const product = this.store.mutate((db) => {
      const now = this.now();
      const kitUnitId =
        input.productType === ProductType.kit
          ? db.units.find(
              (unit) => unit.tenantId === input.tenantId && unit.category === UnitCategory.unit,
            )?.id
          : undefined;
      if (input.productType === ProductType.kit && !kitUnitId)
        throw new Error("A canonical unit is required for kits");
      const created = {
        ...input,
        baseUnitId: kitUnitId ?? input.baseUnitId,
        saleUnitId: kitUnitId ?? input.saleUnitId,
        sku: normalizeSku(input.sku),
        id: this.id("product"),
        createdAt: now,
        updatedAt: now,
      };
      db.products.push(created);
      return created;
    });
    this.emit("product.changed", {
      entityId: product.id,
      tenantId: product.tenantId,
      productId: product.id,
      action: "created",
    });
    return product;
  }
  async update(id: string, input: Parameters<ProductRepository["update"]>[1]) {
    const result = this.store.mutate((db) => {
      const previous = db.products.find((item) => item.id === id);
      if (!previous) throw this.missing("Product", id);
      if (previous.productType === ProductType.physical && input.productType === ProductType.kit) {
        const hasPhysicalHistory =
          db.inventoryBalances.some(
            (item) => item.productId === id && (item.quantity > 0 || item.reservedQuantity > 0),
          ) ||
          db.stockLots.some((item) => item.productId === id) ||
          db.serialNumbers.some((item) => item.productId === id) ||
          db.inventoryReservations.some((item) => item.productId === id);
        const hasSupplierRelations = db.supplierProducts.some((item) => item.productId === id);
        if (hasPhysicalHistory || hasSupplierRelations)
          throw new Error("A physical product with stock or supplier history cannot become a kit");
      }
      const kitUnitId =
        input.productType === ProductType.kit
          ? db.units.find(
              (unit) => unit.tenantId === previous.tenantId && unit.category === UnitCategory.unit,
            )?.id
          : undefined;
      const product = this.updateById(
        db.products,
        id,
        input.sku
          ? {
              ...input,
              sku: normalizeSku(input.sku),
              ...(kitUnitId ? { baseUnitId: kitUnitId, saleUnitId: kitUnitId } : {}),
            }
          : { ...input, ...(kitUnitId ? { baseUnitId: kitUnitId, saleUnitId: kitUnitId } : {}) },
        "Product",
      );
      if (previous.productType === ProductType.kit && product.productType !== ProductType.kit) {
        db.productKitComponents = db.productKitComponents.filter(
          (item) => item.kitProductId !== id,
        );
      }
      const previousPrice = previous.salePrice;
      const newPrice = product.salePrice;
      if (previousPrice !== newPrice) {
        const changedAt = this.now();
        const history = {
          id: this.id("product-price"),
          tenantId: product.tenantId,
          productId: product.id,
          previousPrice,
          newPrice,
          changedAt,
        };
        db.productPriceHistory.push(history);
        db.auditLogs.push({
          id: this.id("audit"),
          tenantId: product.tenantId,
          action: "product.price_changed",
          entityType: "Product",
          entityId: product.id,
          metadata: { previousPrice, newPrice },
          createdAt: changedAt,
        });
        return { product, priceChange: { previousPrice, newPrice } };
      }
      return { product, priceChange: null };
    });
    const { product, priceChange } = result;
    this.emit("product.changed", {
      entityId: product.id,
      tenantId: product.tenantId,
      productId: product.id,
      action: "updated",
    });
    if (priceChange) {
      this.emit("product-price.changed", {
        entityId: product.id,
        tenantId: product.tenantId,
        productId: product.id,
        action: "created",
        previousPrice: priceChange.previousPrice,
        newPrice: priceChange.newPrice,
      });
    }
    return product;
  }
  async archive(id: string) {
    const product = this.store.mutate((db) =>
      this.updateById(db.products, id, { status: ProductStatus.archived }, "Product"),
    );
    this.emit("product.changed", {
      entityId: product.id,
      tenantId: product.tenantId,
      productId: product.id,
      action: "archived",
    });
    return product;
  }
  async updateScoped(
    tenantId: string,
    id: string,
    input: Parameters<ProductRepository["updateScoped"]>[2],
  ) {
    if ("tenantId" in input && input.tenantId !== tenantId) {
      throw new Error("Cross-tenant product update denied");
    }
    if (!(await this.getByIdScoped(tenantId, id))) throw this.missing("Product", id);
    return this.update(id, input);
  }
  async updatePrice(id: string, salePrice: number) {
    return this.update(id, { salePrice });
  }
  async archiveScoped(tenantId: string, id: string) {
    if (!(await this.getByIdScoped(tenantId, id))) throw this.missing("Product", id);
    return this.archive(id);
  }
  async restore(id: string) {
    const product = this.store.mutate((db) =>
      this.updateById(db.products, id, { status: ProductStatus.published }, "Product"),
    );
    this.emit("product.changed", {
      entityId: product.id,
      tenantId: product.tenantId,
      productId: product.id,
      action: "restored",
    });
    return product;
  }
  async restoreScoped(tenantId: string, id: string) {
    if (!(await this.getByIdScoped(tenantId, id))) throw this.missing("Product", id);
    return this.restore(id);
  }
}
