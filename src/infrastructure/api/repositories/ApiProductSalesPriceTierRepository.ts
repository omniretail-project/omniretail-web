import type { ProductSalesPriceTier } from "@/core/entities";
import type { ProductRepository, ProductSalesPriceTierRepository } from "@/core/repositories";
import { backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import {
  apiSalesPriceTierSchema,
  parseApi,
  type ApiSalesPriceTier,
} from "@/infrastructure/api/repositories/productRelationsApi.schema";
import { z } from "zod";

const apiSalesPriceTiersSchema = z.array(apiSalesPriceTierSchema);

export class ApiProductSalesPriceTierRepository implements ProductSalesPriceTierRepository {
  constructor(
    private readonly products: ProductRepository,
    private readonly eventBus: DataEventBus,
  ) {}

  async getByProduct(productId: string): Promise<ProductSalesPriceTier[]> {
    assertApiUuid(productId, "productId");
    const product = await this.products.getById(productId);
    if (!product) return [];
    const items = parseApi(
      apiSalesPriceTiersSchema,
      await backendFetch<unknown>(`/catalog/products/${productId}/price-tiers`),
      "El backend devolvió escalas de precio inválidas.",
    );
    return items.map((item) => toTier(item, product.tenantId));
  }

  async replaceForProduct(
    productId: string,
    tiers: Parameters<ProductSalesPriceTierRepository["replaceForProduct"]>[1],
  ): Promise<ProductSalesPriceTier[]> {
    assertApiUuid(productId, "productId");
    const product = await this.products.getById(productId);
    if (!product) return [];
    const items = parseApi(
      apiSalesPriceTiersSchema,
      await backendFetch<unknown>(`/catalog/products/${productId}/price-tiers`, {
        method: "PUT",
        body: {
          tiers: tiers.map((tier) => ({
            minQuantity: tier.minQuantity,
            unitPrice: tier.unitPrice,
            active: tier.active,
          })),
        },
      }),
      "El backend devolvió escalas de precio inválidas.",
    );
    this.eventBus.emit("product-sales-price-tier.changed", {
      productId,
      tenantId: product.tenantId,
      action: "updated",
    });
    return items.map((item) => toTier(item, product.tenantId));
  }
}

function toTier(item: ApiSalesPriceTier, tenantId: string): ProductSalesPriceTier {
  return {
    ...item,
    tenantId,
    unitPrice: Number(item.unitPrice),
  };
}
