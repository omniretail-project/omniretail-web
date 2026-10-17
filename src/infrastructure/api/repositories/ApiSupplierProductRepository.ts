import type { SupplierCostTier, SupplierProduct } from "@/core/entities";
import type { SupplierProductRepository } from "@/core/repositories";
import type { PaginatedResult } from "@/core/types/pagination.types";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import {
  apiSupplierCostTierSchema,
  apiSupplierProductListSchema,
  apiSupplierProductPageSchema,
  apiSupplierProductSchema,
  parseApi,
  type ApiSupplierCostTier,
  type ApiSupplierProduct,
} from "@/infrastructure/api/repositories/productRelationsApi.schema";
import { z } from "zod";

const BASE_PATH = "/purchasing/supplier-products";
const PAGE_SIZE = 100;
const apiSupplierCostTiersSchema = z.array(apiSupplierCostTierSchema);

export class ApiSupplierProductRepository implements SupplierProductRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getByProduct(productId: string) {
    return this.listOperational({ productId });
  }

  async getBySupplier(supplierId: string) {
    return this.listOperational({ supplierId });
  }

  async getByProductForTenant(tenantId: string, productId: string) {
    return assertTenantScope(await this.listOperational({ productId }), tenantId);
  }

  async getAllByProductForTenant(tenantId: string, productId: string) {
    return assertTenantScope(await this.listAdmin({ productId }), tenantId);
  }

  async getBySupplierForTenant(tenantId: string, supplierId: string) {
    return assertTenantScope(await this.listOperational({ supplierId }), tenantId);
  }

  async create(
    input: Parameters<SupplierProductRepository["create"]>[0],
  ): Promise<SupplierProduct> {
    const item = toSupplierProduct(
      parseApi(
        apiSupplierProductSchema,
        await backendFetch<unknown>(BASE_PATH, {
          method: "POST",
          body: {
            supplierId: input.supplierId,
            productId: input.productId,
            supplierSku: input.supplierSku ?? null,
            purchaseUnitId: input.purchaseUnitId,
            purchaseToBaseFactor: input.purchaseToBaseFactor,
            lastCost: input.lastCost,
            leadTimeDays: input.leadTimeDays,
            minimumOrderQuantity: input.minimumOrderQuantity,
            preferred: input.preferred,
          },
        }),
        "El backend devolvió una relación de proveedor inválida.",
      ),
    );
    this.emit(item, "created");
    return item;
  }

  async update(
    tenantId: string,
    id: string,
    input: Parameters<SupplierProductRepository["update"]>[2],
  ): Promise<SupplierProduct> {
    const current = await this.getRequired(id, tenantId);
    if (input.active === false) return this.archive(tenantId, id);
    let active = current;
    if (!current.active) {
      active = toSupplierProduct(
        parseApi(
          apiSupplierProductSchema,
          await backendFetch<unknown>(`${BASE_PATH}/${id}/reactivate`, { method: "POST" }),
          "El backend devolvió una relación de proveedor inválida.",
        ),
      );
    }
    let updated = toSupplierProduct(
      parseApi(
        apiSupplierProductSchema,
        await backendFetch<unknown>(`${BASE_PATH}/${id}`, {
          method: "PUT",
          body: {
            supplierSku: input.supplierSku ?? active.supplierSku ?? null,
            purchaseUnitId: input.purchaseUnitId ?? active.purchaseUnitId,
            purchaseToBaseFactor:
              input.purchaseToBaseFactor ?? active.purchaseToBaseFactor,
            lastCost: input.lastCost ?? active.lastCost,
            leadTimeDays: input.leadTimeDays ?? active.leadTimeDays,
            minimumOrderQuantity:
              input.minimumOrderQuantity ?? active.minimumOrderQuantity,
          },
        }),
        "El backend devolvió una relación de proveedor inválida.",
      ),
    );
    if (input.preferred === true && !updated.preferred) {
      updated = toSupplierProduct(
        parseApi(
          apiSupplierProductSchema,
          await backendFetch<unknown>(`${BASE_PATH}/${id}/preferred`, { method: "POST" }),
          "El backend devolvió una relación de proveedor inválida.",
        ),
      );
    }
    this.emit(updated, "updated");
    return updated;
  }

  async archive(tenantId: string, id: string): Promise<SupplierProduct> {
    const current = await this.getRequired(id, tenantId);
    await backendFetch<void>(`${BASE_PATH}/${id}`, { method: "DELETE" });
    const archived = { ...current, active: false };
    this.emit(archived, "archived");
    return archived;
  }

  async setPreferred(tenantId: string, productId: string, supplierProductId: string) {
    const current = await this.getRequired(supplierProductId, tenantId);
    if (current.productId !== productId) {
      throw new BackendRequestError("Relación de proveedor no encontrada.", 404);
    }
    const updated = toSupplierProduct(
      parseApi(
        apiSupplierProductSchema,
        await backendFetch<unknown>(`${BASE_PATH}/${supplierProductId}/preferred`, {
          method: "POST",
        }),
        "El backend devolvió una relación de proveedor inválida.",
      ),
    );
    this.emit(updated, "updated");
    return updated;
  }

  async getCostTiers(supplierProductId: string): Promise<SupplierCostTier[]> {
    const supplierProduct = await this.getRequired(supplierProductId);
    return supplierProduct.costTiers ?? [];
  }

  async replaceCostTiers(
    tenantId: string,
    supplierProductId: string,
    tiers: Parameters<SupplierProductRepository["replaceCostTiers"]>[2],
  ): Promise<SupplierCostTier[]> {
    await this.getRequired(supplierProductId, tenantId);
    const values = parseApi(
      apiSupplierCostTiersSchema,
      await backendFetch<unknown>(`${BASE_PATH}/${supplierProductId}/cost-tiers`, {
        method: "PUT",
        body: {
          tiers: tiers.map((tier) => ({
            minQuantity: tier.minQuantity,
            unitCost: tier.unitCost,
          })),
        },
      }),
      "El backend devolvió escalas de costo inválidas.",
    );
    this.eventBus.emit("supplier-product.changed", {
      entityId: supplierProductId,
      tenantId,
      action: "updated",
    });
    return values.map((item) => toCostTier(item, tenantId));
  }

  private async listOperational(query: {
    supplierId?: string;
    productId?: string;
  }): Promise<SupplierProduct[]> {
    this.assertListQuery(query);
    const items = parseApi(
      apiSupplierProductListSchema,
      await backendFetch<unknown>(`${BASE_PATH}/active`, { query }),
      "El backend devolvio relaciones activas de proveedor invalidas.",
    );
    return items.map(toSupplierProduct);
  }

  private async listAdmin(query: {
    supplierId?: string;
    productId?: string;
    active?: boolean;
  }): Promise<SupplierProduct[]> {
    this.assertListQuery(query);
    const first = await this.listPage(1, query);
    const items = [...first.items];
    for (let page = 2; page <= first.totalPages; page += 1) {
      items.push(...(await this.listPage(page, query)).items);
    }
    return items.map(toSupplierProduct);
  }

  private assertListQuery(query: { supplierId?: string; productId?: string }) {
    if (query.supplierId) assertApiUuid(query.supplierId, "supplierId");
    if (query.productId) assertApiUuid(query.productId, "productId");
  }

  private async listPage(
    page: number,
    query: { supplierId?: string; productId?: string; active?: boolean },
  ) {
    return parseApi(
      apiSupplierProductPageSchema,
      await backendFetch<unknown>(BASE_PATH, {
        query: { ...query, page, size: PAGE_SIZE },
      }),
      "El backend devolvió relaciones de proveedor inválidas.",
    ) as PaginatedResult<ApiSupplierProduct>;
  }

  private async getRequired(id: string, tenantId?: string): Promise<SupplierProduct> {
    assertApiUuid(id, "supplierProductId");
    const item = toSupplierProduct(
      parseApi(
        apiSupplierProductSchema,
        await backendFetch<unknown>(`${BASE_PATH}/${id}`),
        "El backend devolvió una relación de proveedor inválida.",
      ),
    );
    if (tenantId && item.tenantId !== tenantId) {
      throw new BackendRequestError("Relación de proveedor no encontrada.", 404);
    }
    return item;
  }

  private emit(item: SupplierProduct, action: "created" | "updated" | "archived") {
    this.eventBus.emit("supplier-product.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      productId: item.productId,
      action,
    });
  }
}

function toSupplierProduct(item: ApiSupplierProduct): SupplierProduct {
  return {
    id: item.id,
    tenantId: item.tenantId,
    supplierId: item.supplierId,
    productId: item.productId,
    supplierSku: item.supplierSku ?? undefined,
    purchaseUnitId: item.purchaseUnitId,
    purchaseToBaseFactor: Number(item.purchaseToBaseFactor),
    lastCost: Number(item.lastCost),
    leadTimeDays: item.leadTimeDays,
    minimumOrderQuantity: Number(item.minimumOrderQuantity),
    preferred: item.preferred,
    active: item.active,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    costTiers: item.costTiers.map((tier) => toCostTier(tier, item.tenantId)),
  };
}

function assertTenantScope(items: SupplierProduct[], tenantId: string): SupplierProduct[] {
  if (items.some((item) => item.tenantId !== tenantId)) {
    throw new BackendRequestError(
      "El backend devolvio relaciones de proveedor fuera del negocio activo.",
      502,
      "TENANT_SCOPE_MISMATCH",
    );
  }
  return items;
}

function toCostTier(item: ApiSupplierCostTier, tenantId: string): SupplierCostTier {
  return {
    id: item.id,
    tenantId,
    supplierProductId: item.supplierProductId,
    minQuantity: Number(item.minQuantity),
    unitCost: Number(item.unitCost),
  };
}
