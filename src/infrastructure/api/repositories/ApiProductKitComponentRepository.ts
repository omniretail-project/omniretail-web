import type { ProductKitComponent } from "@/core/entities";
import type { ProductKitComponentRepository, ProductRepository } from "@/core/repositories";
import { backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import {
  apiKitComponentSchema,
  parseApi,
} from "@/infrastructure/api/repositories/productRelationsApi.schema";
import { z } from "zod";

const apiKitComponentsSchema = z.array(apiKitComponentSchema);

export class ApiProductKitComponentRepository implements ProductKitComponentRepository {
  constructor(
    private readonly products: ProductRepository,
    private readonly eventBus: DataEventBus,
  ) {}

  async getByKitProduct(kitProductId: string): Promise<ProductKitComponent[]> {
    assertApiUuid(kitProductId, "productId");
    const product = await this.products.getById(kitProductId);
    if (!product) return [];
    const values = parseApi(
      apiKitComponentsSchema,
      await backendFetch<unknown>(`/catalog/products/${kitProductId}/kit-components`),
      "El backend devolvió componentes de kit inválidos.",
    );
    return values.map((value) => ({
      id: value.id,
      tenantId: product.tenantId,
      kitProductId,
      componentProductId: value.componentProductId,
      quantityPerKit: Number(value.quantityPerKit),
    }));
  }

  async replaceForKit(
    tenantId: string,
    kitProductId: string,
    components: Parameters<ProductKitComponentRepository["replaceForKit"]>[2],
  ): Promise<ProductKitComponent[]> {
    assertApiUuid(kitProductId, "productId");
    const values = parseApi(
      apiKitComponentsSchema,
      await backendFetch<unknown>(`/catalog/products/${kitProductId}/kit-components`, {
        method: "PUT",
        body: { components },
      }),
      "El backend devolvió componentes de kit inválidos.",
    );
    this.eventBus.emit("product.changed", {
      entityId: kitProductId,
      tenantId,
      productId: kitProductId,
      action: "updated",
    });
    return values.map((value) => ({
      id: value.id,
      tenantId,
      kitProductId,
      componentProductId: value.componentProductId,
      quantityPerKit: Number(value.quantityPerKit),
    }));
  }
}
