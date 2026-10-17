import type { InventoryTransfer, InventoryTransferItem } from "@/core/entities";
import { InventoryTransferReason, InventoryTransferStatus } from "@/core/enums";
import type {
  DispatchInventoryTransferInput,
  InventoryTransferFilters,
  InventoryTransferRepository,
  InventoryTransferWithItems,
  ReceiveInventoryTransferInput,
} from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import {
  parseApiInventoryTransfer,
  parseApiInventoryTransferPage,
  type ApiInventoryTransfer,
} from "@/infrastructure/api/repositories/inventoryTransfersApi.schema";

const PAGE_SIZE = 100;

/** API adapter for the transfer lifecycle. Creation is deliberately omitted: the public backend
 * creates a transfer only when it approves a transfer request. */
export class ApiInventoryTransferRepository {
  constructor(
    private readonly eventBus: DataEventBus,
    private readonly resolveTenantId: () => Promise<string>,
  ) {}

  withTransferDelegate(delegate: InventoryTransferRepository): InventoryTransferRepository {
    const getById = this.getById.bind(this);
    const query = this.query.bind(this);
    const markInTransit = this.markInTransit.bind(this);
    const markReceived = this.markReceived.bind(this);
    const cancel = this.cancel.bind(this);
    return new Proxy(delegate, {
      get: (target, property) => {
        if (property === "getById") return getById;
        if (property === "query") return query;
        if (property === "markInTransit") return markInTransit;
        if (property === "markReceived") return markReceived;
        if (property === "cancel") return cancel;
        if (property === "create" || property === "getByNumber") return unsupportedOperation;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async getById(id: string): Promise<InventoryTransferWithItems | null> {
    assertApiUuid(id, "transferId");
    try {
      return toTransfer(
        parseApiInventoryTransfer(await backendFetch<unknown>(`/inventory/transfers/${id}`)),
        await this.resolveTenantId(),
      );
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async query(filters: InventoryTransferFilters = {}): Promise<InventoryTransferWithItems[]> {
    assertOptionalApiUuid(filters.sourceBranchId, "sourceBranchId");
    assertOptionalApiUuid(filters.destinationBranchId, "destinationBranchId");
    const tenantId = filters.tenantId ?? (await this.resolveTenantId());
    const first = parseApiInventoryTransferPage(
      await backendFetch<unknown>("/inventory/transfers", {
        query: {
          sourceBranchId: filters.sourceBranchId,
          destinationBranchId: filters.destinationBranchId,
          status: filters.status,
          page: 1,
          size: PAGE_SIZE,
        },
      }),
    );
    const remaining = await Promise.all(
      Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
        backendFetch<unknown>("/inventory/transfers", {
          query: {
            sourceBranchId: filters.sourceBranchId,
            destinationBranchId: filters.destinationBranchId,
            status: filters.status,
            page: index + 2,
            size: PAGE_SIZE,
          },
        }).then(parseApiInventoryTransferPage),
      ),
    );
    return [first, ...remaining]
      .flatMap((page) => page.items)
      .map((item) => toTransfer(item, tenantId));
  }

  async markInTransit(id: string, input: DispatchInventoryTransferInput) {
    assertApiUuid(id, "transferId");
    await backendFetch<unknown>(`/logistics/dispatch/transfers/${id}/confirm`, {
      method: "POST",
      body: { operationId: input.operationId },
      headers: { "Idempotency-Key": input.operationId },
    });
    const updated = await this.getById(id);
    if (!updated)
      throw new BackendRequestError("No se pudo recuperar el traslado despachado.", 502);
    this.emit(updated.transfer, "status_changed");
    return updated;
  }

  async markReceived(id: string, input: ReceiveInventoryTransferInput) {
    assertApiUuid(id, "transferId");
    const locations = new Set(input.items.map((item) => item.locationId));
    if (locations.size !== 1) {
      throw new BackendRequestError(
        "La API actual recibe un traslado en una sola ubicación de destino por confirmación.",
        400,
        "TRANSFER_RECEIPT_LOCATION_REQUIRED",
      );
    }
    const destinationLocationId = input.items[0]?.locationId;
    assertApiUuid(destinationLocationId, "destinationLocationId");
    if (input.items.some((item) => item.lotNumber || item.serialNumbers?.length)) {
      throw new BackendRequestError(
        "La API de traslados requiere los identificadores de lote despachados para recibir productos trazables; el contrato web aún no los expone.",
        501,
        "TRANSFER_TRACEABILITY_NOT_SUPPORTED",
      );
    }
    await backendFetch<unknown>(`/inventory/transfers/${id}/receipts`, {
      method: "POST",
      headers: { "Idempotency-Key": input.confirmationId },
      body: {
        confirmationId: input.confirmationId,
        destinationLocationId,
        items: input.items.map((item) => ({
          itemId: item.itemId,
          receivedQuantity: item.receivedQuantity,
          receivedSelections: [],
        })),
      },
    });
    const updated = await this.getById(id);
    if (!updated) throw new BackendRequestError("No se pudo recuperar el traslado recibido.", 502);
    this.emit(updated.transfer, "status_changed");
    return updated;
  }

  async cancel(id: string, input: { reason: string; actorUserId: string; operationId: string }) {
    assertApiUuid(id, "transferId");
    const transfer = toTransfer(
      parseApiInventoryTransfer(
        await backendFetch<unknown>(`/inventory/transfers/${id}/cancel`, {
          method: "POST",
          body: { reason: input.reason },
          headers: { "Idempotency-Key": input.operationId },
        }),
      ),
      await this.resolveTenantId(),
    );
    this.emit(transfer.transfer, "status_changed");
    return transfer;
  }

  private emit(transfer: InventoryTransfer, action: "status_changed") {
    const payload = { entityId: transfer.id, tenantId: transfer.tenantId, action } as const;
    this.eventBus.emit("inventory-transfer.changed", payload);
    this.eventBus.emit("inventory.changed", payload);
    this.eventBus.emit("stock.changed", payload);
  }
}

export function toTransfer(
  api: ApiInventoryTransfer,
  tenantId: string,
): InventoryTransferWithItems {
  const transfer: InventoryTransfer = {
    id: api.id,
    tenantId,
    number: api.number,
    sourceBranchId: api.sourceBranchId,
    destinationBranchId: api.destinationBranchId,
    status: InventoryTransferStatus[api.status],
    reason: InventoryTransferReason[api.reason],
    notes: api.notes ?? undefined,
    preparedByUserId: api.preparedByUserId ?? undefined,
    dispatchedByUserId: api.dispatchedByUserId ?? undefined,
    dispatchedAt: api.dispatchedAt ?? undefined,
    receivedByUserId: api.receivedByUserId ?? undefined,
    receivedAt: api.receivedAt ?? undefined,
    cancelledByUserId: api.cancelledByUserId ?? undefined,
    cancelledAt: api.cancelledAt ?? undefined,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
  const items: InventoryTransferItem[] = api.items.map((item) => ({
    id: item.id,
    transferId: api.id,
    productId: item.productId,
    sourceRequestId: item.sourceRequestId ?? undefined,
    requestedQuantity: item.requestedQuantity,
    dispatchedQuantity: item.dispatchedQuantity,
    receivedQuantity: item.receivedQuantity,
  }));
  return { transfer, items };
}

function unsupportedOperation(): Promise<never> {
  return Promise.reject(
    new BackendRequestError(
      "La creación directa de traslados no está disponible en la API; primero aprueba una solicitud.",
      501,
      "NOT_SUPPORTED",
    ),
  );
}
