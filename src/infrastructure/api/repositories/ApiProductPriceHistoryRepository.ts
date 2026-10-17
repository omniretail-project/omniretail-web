import type { ProductPriceHistory } from "@/core/entities";
import type { ProductPriceHistoryRepository, ProductRepository } from "@/core/repositories";
import type { PaginatedResult } from "@/core/types/pagination.types";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import {
  apiPriceHistoryPageSchema,
  parseApi,
  type ApiPriceHistory,
} from "@/infrastructure/api/repositories/productRelationsApi.schema";

const PAGE_SIZE = 100;

export class ApiProductPriceHistoryRepository implements ProductPriceHistoryRepository {
  constructor(private readonly products: ProductRepository) {}

  async getByProduct(productId: string): Promise<ProductPriceHistory[]> {
    assertApiUuid(productId, "productId");
    const product = await this.products.getById(productId);
    if (!product) return [];
    const first = await this.getPage(productId, 1);
    const items = [...first.items];
    for (let page = 2; page <= first.totalPages; page += 1) {
      items.push(...(await this.getPage(productId, page)).items);
    }
    return items.map((item) => toHistory(item, product.tenantId));
  }

  async record(): Promise<ProductPriceHistory> {
    throw new BackendRequestError(
      "Products API genera el historial al actualizar el precio; no admite registro manual.",
      405,
      "PRICE_HISTORY_RECORD_UNSUPPORTED",
    );
  }

  private async getPage(productId: string, page: number) {
    return parseApi(
      apiPriceHistoryPageSchema,
      await backendFetch<unknown>(`/catalog/products/${productId}/price-history`, {
        query: { page, size: PAGE_SIZE },
      }),
      "El backend devolvió un historial de precios inválido.",
    ) as PaginatedResult<ApiPriceHistory>;
  }
}

function toHistory(item: ApiPriceHistory, tenantId: string): ProductPriceHistory {
  return {
    id: item.id,
    tenantId,
    productId: item.productId,
    previousPrice: Number(item.oldPrice),
    newPrice: Number(item.newPrice),
    actorUserId: item.changedByUserId ?? undefined,
    reason: item.reason ?? undefined,
    changedAt: item.createdAt,
  };
}
