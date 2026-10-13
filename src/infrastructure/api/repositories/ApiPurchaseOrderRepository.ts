import type { PurchaseOrder } from "@/core/entities";
import { PurchaseOrderStatus } from "@/core/enums";
import type {
  CreatePurchaseOrderInput,
  PurchaseOrderPageParams,
  PurchaseOrderRepository,
  UpdatePurchaseOrderInput,
} from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import {
  parseApiPurchaseOrder,
  parseApiPurchaseOrderPage,
  parsePurchaseOrderCancellationRequest,
  parsePurchaseOrderMutationRequest,
  type ApiPurchaseOrder,
} from "@/infrastructure/api/repositories/purchaseOrderApi.schema";

const UNSUPPORTED_OPERATIONS = new Set<PropertyKey>([
  "getAll",
  "getById",
  "listByTenant",
  "update",
  "updateStatus",
  "updateStatusScoped",
]);

export class ApiPurchaseOrderRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  withPurchaseOrderDelegate(delegate: PurchaseOrderRepository): PurchaseOrderRepository {
    const getPageScoped = this.getPageScoped.bind(this);
    const getByIdScoped = this.getByIdScoped.bind(this);
    const create = this.create.bind(this);
    const updateScoped = this.updateScoped.bind(this);
    const submitScoped = this.submitScoped.bind(this);
    const approveScoped = this.approveScoped.bind(this);
    const cancelScoped = this.cancelScoped.bind(this);
    return new Proxy(delegate, {
      get: (target, property) => {
        if (property === "getPageScoped") return getPageScoped;
        if (property === "getByIdScoped") return getByIdScoped;
        if (property === "create") return create;
        if (property === "updateScoped") return updateScoped;
        if (property === "submitScoped") return submitScoped;
        if (property === "approveScoped") return approveScoped;
        if (property === "cancelScoped") return cancelScoped;
        if (UNSUPPORTED_OPERATIONS.has(property)) return unsupportedOperation;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async getPageScoped(tenantId: string, params: PurchaseOrderPageParams) {
    assertPage(params.page, params.pageSize);
    assertOptionalApiUuid(params.branchId, "branchId");
    assertOptionalApiUuid(params.supplierId, "supplierId");
    const page = parseApiPurchaseOrderPage(
      await backendFetch<unknown>("/purchasing/orders", {
        query: {
          branchId: params.branchId,
          supplierId: params.supplierId,
          status: params.status,
          search: params.search?.trim() || undefined,
          page: params.page,
          size: params.pageSize,
        },
      }),
    );
    return {
      ...page,
      items: page.items.map((order) => toPurchaseOrder(order, tenantId)),
    };
  }

  async getByIdScoped(tenantId: string, id: string) {
    assertApiUuid(id, "purchaseOrderId");
    try {
      return toPurchaseOrder(
        parseApiPurchaseOrder(await backendFetch<unknown>(`/purchasing/orders/${id}`)),
        tenantId,
      );
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async create(input: CreatePurchaseOrderInput) {
    const order = toPurchaseOrder(
      parseApiPurchaseOrder(
        await backendFetch<unknown>("/purchasing/orders", {
          method: "POST",
          body: toMutationRequest(input),
        }),
      ),
      input.tenantId,
    );
    this.emit(order, "created");
    return order;
  }

  async updateScoped(tenantId: string, id: string, input: UpdatePurchaseOrderInput) {
    assertApiUuid(id, "purchaseOrderId");
    const order = toPurchaseOrder(
      parseApiPurchaseOrder(
        await backendFetch<unknown>(`/purchasing/orders/${id}`, {
          method: "PUT",
          body: toMutationRequest(input),
        }),
      ),
      tenantId,
    );
    this.emit(order, "updated");
    return order;
  }

  async submitScoped(tenantId: string, id: string) {
    return this.transition(tenantId, id, "submit");
  }

  async approveScoped(tenantId: string, id: string) {
    return this.transition(tenantId, id, "approve");
  }

  async cancelScoped(tenantId: string, id: string, reason: string) {
    assertApiUuid(id, "purchaseOrderId");
    const body = parsePurchaseOrderCancellationRequest({ reason });
    const order = toPurchaseOrder(
      parseApiPurchaseOrder(
        await backendFetch<unknown>(`/purchasing/orders/${id}/cancel`, {
          method: "POST",
          body,
        }),
      ),
      tenantId,
    );
    this.emit(order, "status_changed");
    return order;
  }

  private async transition(tenantId: string, id: string, action: "submit" | "approve") {
    assertApiUuid(id, "purchaseOrderId");
    const order = toPurchaseOrder(
      parseApiPurchaseOrder(
        await backendFetch<unknown>(`/purchasing/orders/${id}/${action}`, { method: "POST" }),
      ),
      tenantId,
    );
    this.emit(order, "status_changed");
    return order;
  }

  private emit(order: PurchaseOrder, action: "created" | "updated" | "status_changed") {
    this.eventBus.emit("purchase-order.changed", {
      entityId: order.id,
      tenantId: order.tenantId,
      branchId: order.branchId,
      action,
    });
  }
}

function toMutationRequest(input: CreatePurchaseOrderInput | UpdatePurchaseOrderInput) {
  return parsePurchaseOrderMutationRequest({
    branchId: input.branchId,
    supplierId: input.supplierId,
    expectedDate: input.expectedDate ? input.expectedDate.slice(0, 10) : null,
    notes: input.notes?.trim() || null,
    items: input.items?.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitCost: item.unitCost,
    })),
  });
}

function unsupportedOperation(): Promise<never> {
  return Promise.reject(
    new BackendRequestError(
      "Esta operacion de ordenes de compra aun no esta disponible por API.",
      501,
      "NOT_SUPPORTED",
    ),
  );
}

function toPurchaseOrder(api: ApiPurchaseOrder, tenantId: string): PurchaseOrder {
  return {
    id: api.id,
    tenantId,
    branchId: api.branchId,
    number: api.number,
    supplierId: api.supplierId,
    supplierNameSnapshot: api.supplierName,
    status: PurchaseOrderStatus[api.status],
    expectedDate: api.expectedDate ?? undefined,
    notes: api.notes ?? undefined,
    subtotal: api.subtotal,
    total: api.total,
    createdByUserId: api.createdByUserId,
    approvedByUserId: api.approvedByUserId ?? undefined,
    approvedAt: api.approvedAt ?? undefined,
    cancellationReason: api.cancellationReason ?? undefined,
    cancelledByUserId: api.cancelledByUserId ?? undefined,
    cancelledAt: api.cancelledAt ?? undefined,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
    items: api.items.map((item) => ({
      id: item.id,
      purchaseOrderId: api.id,
      supplierProductId: item.supplierProductId,
      productId: item.productId,
      productNameSnapshot: item.productName,
      productSkuSnapshot: item.productSku,
      supplierSkuSnapshot: item.supplierSku ?? undefined,
      quantity: item.quantity,
      unitId: item.unitId,
      unitSymbolSnapshot: item.unitSymbol,
      purchaseToBaseFactor: item.purchaseToBaseFactor,
      unitCost: item.unitCost,
      suggestedUnitCost: item.suggestedUnitCost ?? undefined,
      subtotal: item.subtotal,
    })),
  };
}

function assertPage(page: number, pageSize: number) {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new BackendRequestError("page debe comenzar en 1.", 400, "INVALID_PAGE");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BackendRequestError("pageSize debe estar entre 1 y 100.", 400, "INVALID_PAGE_SIZE");
  }
}
