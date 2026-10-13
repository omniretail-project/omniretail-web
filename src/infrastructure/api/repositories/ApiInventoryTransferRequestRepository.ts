import type { InventoryTransferRequest } from "@/core/entities";
import { InventoryTransferReason, InventoryTransferRequestStatus } from "@/core/enums";
import type {
  CreateInventoryTransferRequestInput,
  InventoryTransferRequestFilters,
  InventoryTransferRequestRepository,
  ReviewInventoryTransferRequestInput,
} from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import {
  parseApiInventoryTransferRequest,
  parseApiInventoryTransferRequestPage,
  type ApiInventoryTransferRequest,
} from "@/infrastructure/api/repositories/inventoryTransfersApi.schema";

const PAGE_SIZE = 100;

export class ApiInventoryTransferRequestRepository {
  constructor(
    private readonly eventBus: DataEventBus,
    private readonly resolveTenantId: () => Promise<string>,
  ) {}

  withRequestDelegate(
    delegate: InventoryTransferRequestRepository,
  ): InventoryTransferRequestRepository {
    const getById = this.getById.bind(this);
    const getRequests = this.getRequests.bind(this);
    const createRequest = this.createRequest.bind(this);
    const approveRequest = this.approveRequest.bind(this);
    const rejectRequest = this.rejectRequest.bind(this);
    const cancelRequest = this.cancelRequest.bind(this);
    return new Proxy(delegate, {
      get: (target, property) => {
        if (property === "getById") return getById;
        if (property === "getRequests") return getRequests;
        if (property === "createRequest") return createRequest;
        if (property === "approveRequest") return approveRequest;
        if (property === "rejectRequest") return rejectRequest;
        if (property === "cancelRequest") return cancelRequest;
        if (property === "markInTransit" || property === "markReceived")
          return unsupportedOperation;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async getById(id: string) {
    assertApiUuid(id, "transferRequestId");
    const request = (await this.getRequests()).find((item) => item.id === id);
    return request ?? null;
  }

  async getRequests(filters: InventoryTransferRequestFilters = {}) {
    assertOptionalApiUuid(filters.requestingBranchId, "requestingBranchId");
    assertOptionalApiUuid(filters.sourceBranchId, "sourceBranchId");
    const tenantId = filters.tenantId ?? (await this.resolveTenantId());
    const first = parseApiInventoryTransferRequestPage(
      await backendFetch<unknown>("/inventory/transfer-requests", {
        query: {
          requestingBranchId: filters.requestingBranchId,
          sourceBranchId: filters.sourceBranchId,
          // effectiveStatus puede ser inTransit/received, valores que el filtro del backend no
          // admite. Se lee el conjunto autorizado y se filtra después de mapearlo.
          status: undefined,
          page: 1,
          size: PAGE_SIZE,
        },
      }),
    );
    const remaining = await Promise.all(
      Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
        backendFetch<unknown>("/inventory/transfer-requests", {
          query: {
            requestingBranchId: filters.requestingBranchId,
            sourceBranchId: filters.sourceBranchId,
            status: undefined,
            page: index + 2,
            size: PAGE_SIZE,
          },
        }).then(parseApiInventoryTransferRequestPage),
      ),
    );
    return [first, ...remaining]
      .flatMap((page) => page.items)
      .map((item) => toRequest(item, tenantId))
      .filter((item) => !filters.status || item.status === filters.status);
  }

  async createRequest(input: CreateInventoryTransferRequestInput) {
    const request = toRequest(
      parseApiInventoryTransferRequest(
        await backendFetch<unknown>("/inventory/transfer-requests", {
          method: "POST",
          body: {
            requestingBranchId: input.requestingBranchId,
            sourceBranchId: input.sourceBranchId,
            productId: input.productId,
            requestedQuantity: input.requestedQuantity,
            reason: input.reason,
            notes: input.notes?.trim() || null,
          },
        }),
      ),
      input.tenantId,
    );
    this.emit(request, "created");
    return request;
  }

  async approveRequest(id: string, input: ReviewInventoryTransferRequestInput = {}) {
    assertApiUuid(id, "transferRequestId");
    const operationId = input.operationId?.trim() || `transfer-request:${id}`;
    await backendFetch<unknown>(`/inventory/transfer-requests/${id}/approve`, {
      method: "POST",
      body: { operationId, reviewNotes: null },
      headers: { "Idempotency-Key": operationId },
    });
    const request = await this.getById(id);
    if (!request) throw new BackendRequestError("No se pudo recuperar la solicitud aprobada.", 502);
    this.emit(request, "status_changed");
    return request;
  }

  async rejectRequest(id: string, rejectionReason: string) {
    assertApiUuid(id, "transferRequestId");
    const request = toRequest(
      parseApiInventoryTransferRequest(
        await backendFetch<unknown>(`/inventory/transfer-requests/${id}/reject`, {
          method: "POST",
          body: { reviewNotes: rejectionReason },
        }),
      ),
      await this.resolveTenantId(),
    );
    this.emit(request, "status_changed");
    return request;
  }

  async cancelRequest(id: string, reason?: string) {
    assertApiUuid(id, "transferRequestId");
    const request = toRequest(
      parseApiInventoryTransferRequest(
        await backendFetch<unknown>(`/inventory/transfer-requests/${id}/cancel`, {
          method: "POST",
          body: { reason: reason?.trim() || null },
        }),
      ),
      await this.resolveTenantId(),
    );
    this.emit(request, "status_changed");
    return request;
  }

  private emit(request: InventoryTransferRequest, action: "created" | "status_changed") {
    const payload = {
      entityId: request.id,
      tenantId: request.tenantId,
      branchId: request.requestingBranchId,
      action,
    } as const;
    this.eventBus.emit("inventory-transfer-request.changed", payload);
    this.eventBus.emit("inventory.changed", payload);
  }
}

export function toRequest(
  api: ApiInventoryTransferRequest,
  tenantId: string,
): InventoryTransferRequest {
  return {
    id: api.id,
    tenantId,
    requestingBranchId: api.requestingBranchId,
    sourceBranchId: api.sourceBranchId,
    productId: api.productId,
    requestedQuantity: api.requestedQuantity,
    reason: InventoryTransferReason[api.reason],
    notes: api.notes ?? undefined,
    status: InventoryTransferRequestStatus[api.effectiveStatus],
    rejectionReason:
      api.effectiveStatus === "rejected" ? (api.reviewNotes ?? undefined) : undefined,
    requestedAt: api.requestedAt ?? api.createdAt,
    reviewedAt: api.reviewedAt ?? undefined,
    approvedAt: api.effectiveStatus === "approved" ? (api.reviewedAt ?? undefined) : undefined,
    rejectedAt: api.effectiveStatus === "rejected" ? (api.reviewedAt ?? undefined) : undefined,
    requestedByUserId: api.requestedByUserId ?? undefined,
    reviewedByUserId: api.reviewedByUserId ?? undefined,
    transferId: api.transferId ?? undefined,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

function unsupportedOperation(): Promise<never> {
  return Promise.reject(
    new BackendRequestError(
      "El estado del traslado se actualiza mediante los endpoints de traslado y recepción.",
      501,
      "NOT_SUPPORTED",
    ),
  );
}
