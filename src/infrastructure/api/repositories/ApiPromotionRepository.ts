import type { Promotion } from "@/core/entities";
import { PromotionStatus, PromotionType, SalesChannel } from "@/core/enums";
import type {
  ProductRepository,
  PromotionApplicabilityCriteria,
  PromotionRepository,
} from "@/core/repositories";
import type { PaginatedResult } from "@/core/types/pagination.types";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import {
  apiPromotionPageSchema,
  apiPromotionSchema,
  parseApi,
  type ApiPromotion,
} from "@/infrastructure/api/repositories/productRelationsApi.schema";

const PAGE_SIZE = 100;

export class ApiPromotionRepository implements PromotionRepository {
  constructor(
    private readonly products: ProductRepository,
    private readonly eventBus: DataEventBus,
  ) {}

  async getAll(): Promise<Promotion[]> {
    const ids = await this.listIds();
    return Promise.all(ids.map((id) => this.getRequired(id)));
  }

  async getActive(): Promise<Promotion[]> {
    return (await this.getAll()).filter((item) => item.status === PromotionStatus.active);
  }

  async getActiveByTenant(tenantId: string): Promise<Promotion[]> {
    return (await this.getAll()).filter(
      (item) => item.tenantId === tenantId && item.status === PromotionStatus.active,
    );
  }

  async getByProduct(productId: string): Promise<Promotion[]> {
    const product = await this.products.getById(productId);
    if (!product) return [];
    return this.getByProductScoped(product.tenantId, productId);
  }

  async getByProductScoped(tenantId: string, productId: string): Promise<Promotion[]> {
    assertApiUuid(productId, "productId");
    const product = await this.products.getByIdScoped(tenantId, productId);
    if (!product) return [];
    const ids = await this.listIds(productId);
    return Promise.all(ids.map((id) => this.getRequired(id, tenantId)));
  }

  async getByIdScoped(tenantId: string, id: string): Promise<Promotion | null> {
    assertApiUuid(id, "promotionId");
    try {
      return await this.getRequired(id, tenantId);
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async getApplicable(criteria: PromotionApplicabilityCriteria): Promise<Promotion | null> {
    const at = new Date(criteria.at).getTime();
    return (
      (await this.getByProductScoped(criteria.tenantId, criteria.productId)).find((promotion) => {
        const startsAt = new Date(promotion.startAt).getTime();
        const endsAt = promotion.endAt
          ? new Date(promotion.endAt).getTime()
          : Number.POSITIVE_INFINITY;
        const appliesToBranch =
          promotion.branchIds.length === 0 ||
          Boolean(criteria.branchId && promotion.branchIds.includes(criteria.branchId));
        return (
          promotion.status === PromotionStatus.active &&
          startsAt <= at &&
          at <= endsAt &&
          promotion.channels.includes(criteria.channel) &&
          appliesToBranch
        );
      }) ?? null
    );
  }

  async create(input: Parameters<PromotionRepository["create"]>[0]): Promise<Promotion> {
    const api = parseApi(
      apiPromotionSchema,
      await backendFetch<unknown>("/catalog/promotions", {
        method: "POST",
        body: toRequest(input),
      }),
      "El backend devolvió una promoción inválida.",
    );
    const promotion = toPromotion(api, input.tenantId);
    this.emit(promotion, "created");
    return promotion;
  }

  async update(
    id: string,
    input: Parameters<PromotionRepository["update"]>[1],
  ): Promise<Promotion> {
    const productId = input.productIds?.[0];
    const tenantId = input.tenantId ?? (productId ? (await this.products.getById(productId))?.tenantId : undefined);
    if (!tenantId) throw new BackendRequestError("No se pudo resolver la promoción.", 400);
    return this.updateScoped(tenantId, id, input);
  }

  async updateScoped(
    tenantId: string,
    id: string,
    input: Parameters<PromotionRepository["updateScoped"]>[2],
  ): Promise<Promotion> {
    assertApiUuid(id, "promotionId");
    if (input.status === PromotionStatus.ended) return this.endScoped(tenantId, id);
    if (input.status === PromotionStatus.cancelled) return this.cancelScoped(tenantId, id);
    const current = await this.getByIdScoped(tenantId, id);
    if (!current) throw new BackendRequestError("Promoción no encontrada.", 404);
    const next = { ...current, ...input, tenantId };
    const api = parseApi(
      apiPromotionSchema,
      await backendFetch<unknown>(`/catalog/promotions/${id}`, {
        method: "PUT",
        body: toRequest(next),
      }),
      "El backend devolvió una promoción inválida.",
    );
    const promotion = toPromotion(api, tenantId);
    this.emit(promotion, "updated");
    return promotion;
  }

  async endScoped(tenantId: string, id: string): Promise<Promotion> {
    return this.lifecycle(tenantId, id, "end");
  }

  async cancelScoped(tenantId: string, id: string): Promise<Promotion> {
    return this.lifecycle(tenantId, id, "cancel");
  }

  private async lifecycle(tenantId: string, id: string, action: "end" | "cancel") {
    assertApiUuid(id, "promotionId");
    const api = parseApi(
      apiPromotionSchema,
      await backendFetch<unknown>(`/catalog/promotions/${id}/${action}`, { method: "PUT" }),
      "El backend devolvió una promoción inválida.",
    );
    const promotion = toPromotion(api, tenantId);
    this.emit(promotion, "updated");
    return promotion;
  }

  private async listIds(productId?: string): Promise<string[]> {
    const first = await this.listPage(1, productId);
    const ids = first.items.map((item) => item.id);
    for (let page = 2; page <= first.totalPages; page += 1) {
      ids.push(...(await this.listPage(page, productId)).items.map((item) => item.id));
    }
    return ids;
  }

  private async listPage(page: number, productId?: string) {
    return parseApi(
      apiPromotionPageSchema,
      await backendFetch<unknown>("/catalog/promotions", {
        query: { productId, page, size: PAGE_SIZE },
      }),
      "El backend devolvió promociones inválidas.",
    ) as PaginatedResult<{ id: string }>;
  }

  private async getRequired(id: string, knownTenantId?: string): Promise<Promotion> {
    const api = parseApi(
      apiPromotionSchema,
      await backendFetch<unknown>(`/catalog/promotions/${id}`),
      "El backend devolvió una promoción inválida.",
    );
    const tenantId = knownTenantId ?? (await this.resolveTenant(api));
    return toPromotion(api, tenantId);
  }

  private async resolveTenant(api: ApiPromotion): Promise<string> {
    const firstProductId = api.products[0]?.id;
    const product = firstProductId ? await this.products.getById(firstProductId) : null;
    if (!product) {
      throw new BackendRequestError(
        "No se pudo resolver el negocio de la promoción.",
        502,
        "INVALID_BACKEND_RESPONSE",
      );
    }
    return product.tenantId;
  }

  private emit(promotion: Promotion, action: "created" | "updated") {
    const productIds = promotion.productIds.length ? promotion.productIds : [undefined];
    productIds.forEach((productId) => {
      this.eventBus.emit("promotion.changed", {
        entityId: promotion.id,
        tenantId: promotion.tenantId,
        productId,
        action,
      });
    });
  }
}

function toPromotion(api: ApiPromotion, tenantId: string): Promotion {
  return {
    id: api.id,
    tenantId,
    name: api.name,
    description: api.description ?? undefined,
    type: fromApiType(api.discountType),
    value: Number(api.discountValue),
    channels: api.channels.map((channel) => SalesChannel[channel]),
    startAt: api.startsAt,
    endAt: api.endsAt ?? undefined,
    untilStockEnds: api.untilStockEnds,
    branchIds: api.branchIds,
    productIds: api.products.map((product) => product.id),
    status: PromotionStatus[api.status],
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

function toRequest(promotion: Omit<Promotion, "id" | "createdAt" | "updatedAt"> | Promotion) {
  return {
    name: promotion.name,
    description: promotion.description ?? null,
    discountType: toApiType(promotion.type),
    discountValue: promotion.value,
    startsAt: promotion.startAt,
    endsAt: promotion.endAt ?? null,
    productIds: promotion.productIds,
    channels: promotion.channels,
    untilStockEnds: promotion.untilStockEnds,
    branchIds: promotion.branchIds,
  };
}

function toApiType(type: PromotionType) {
  if (type === PromotionType.fixedDiscount) return "fixed_discount";
  if (type === PromotionType.fixedPrice) return "fixed_price";
  return "percentage";
}

function fromApiType(type: ApiPromotion["discountType"]): PromotionType {
  if (type === "fixed_discount") return PromotionType.fixedDiscount;
  if (type === "fixed_price") return PromotionType.fixedPrice;
  return PromotionType.percentage;
}
