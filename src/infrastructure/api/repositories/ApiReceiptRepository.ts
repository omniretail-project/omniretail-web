import type { Receipt } from "@/core/entities";
import { ReceiptLineStatus, ReceiptStatus } from "@/core/enums";
import type {
  CreateReceiptIncidentScopedInput,
  ReceiptDraftInput,
  ReceiptIncidentRecord,
  ReceiptPageParams,
  ReceiptRecord,
  ReceiptRepository,
  ResolveReceiptIncidentWithReplacementInput,
  SerialValidationResult,
  ValidateSerialNumbersInput,
} from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import {
  parseApiGoodsReceipt,
  parseApiGoodsReceiptPage,
  parseApiReceiptIncident,
  parseApiReceiptIncidentPage,
  parseApiSerialValidation,
  parseResolveWithReplacementRequest,
  parseGoodsReceiptCreateRequest,
  parseGoodsReceiptUpdateRequest,
  parseReceiptIncidentCreateRequest,
  type ApiReceiptIncident,
  type ApiGoodsReceipt,
} from "@/infrastructure/api/repositories/receiptApi.schema";

const UNSUPPORTED_LEGACY_OPERATIONS = new Set<PropertyKey>([
  "getAll",
  "getById",
  "listByTenant",
  "getByConfirmationId",
  "getLinesByReceipt",
  "getIncidents",
  "create",
  "update",
  "updateStatus",
  "confirmReceiptInventory",
  "replaceLines",
  "replaceIncidents",
  "addIncident",
]);

export class ApiReceiptRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  withReceiptDelegate(delegate: ReceiptRepository): ReceiptRepository {
    const getPageScoped = this.getPageScoped.bind(this);
    const getRecordByIdScoped = this.getRecordByIdScoped.bind(this);
    const createDraftScoped = this.createDraftScoped.bind(this);
    const updateDraftScoped = this.updateDraftScoped.bind(this);
    const deleteDraftScoped = this.deleteDraftScoped.bind(this);
    const confirmDraftScoped = this.confirmDraftScoped.bind(this);
    const listIncidentsScoped = this.listIncidentsScoped.bind(this);
    const createIncidentScoped = this.createIncidentScoped.bind(this);
    const resolveIncidentScoped = this.resolveIncidentScoped.bind(this);
    const resolveIncidentWithReplacementScoped =
      this.resolveIncidentWithReplacementScoped.bind(this);
    const validateSerialNumbersScoped = this.validateSerialNumbersScoped.bind(this);
    return new Proxy(delegate, {
      get: (target, property) => {
        if (property === "getPageScoped") return getPageScoped;
        if (property === "getRecordByIdScoped") return getRecordByIdScoped;
        if (property === "createDraftScoped") return createDraftScoped;
        if (property === "updateDraftScoped") return updateDraftScoped;
        if (property === "deleteDraftScoped") return deleteDraftScoped;
        if (property === "confirmDraftScoped") return confirmDraftScoped;
        if (property === "listIncidentsScoped") return listIncidentsScoped;
        if (property === "createIncidentScoped") return createIncidentScoped;
        if (property === "resolveIncidentScoped") return resolveIncidentScoped;
        if (property === "resolveIncidentWithReplacementScoped") {
          return resolveIncidentWithReplacementScoped;
        }
        if (property === "validateSerialNumbersScoped") return validateSerialNumbersScoped;
        if (UNSUPPORTED_LEGACY_OPERATIONS.has(property)) return unsupportedOperation;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async getPageScoped(tenantId: string, params: ReceiptPageParams) {
    assertPage(params.page, params.pageSize);
    assertOptionalApiUuid(params.branchId, "branchId");
    assertOptionalApiUuid(params.purchaseOrderId, "purchaseOrderId");
    const page = parseApiGoodsReceiptPage(
      await backendFetch<unknown>("/purchasing/receipts", {
        query: {
          branchId: params.branchId,
          purchaseOrderId: params.purchaseOrderId,
          status: params.status,
          page: params.page,
          size: params.pageSize,
        },
      }),
    );
    return {
      ...page,
      items: page.items.map((receipt) => mapApiReceipt(receipt, tenantId)),
    };
  }

  async getRecordByIdScoped(tenantId: string, id: string) {
    assertApiUuid(id, "receiptId");
    try {
      return mapApiReceipt(
        parseApiGoodsReceipt(await backendFetch<unknown>(`/purchasing/receipts/${id}`)),
        tenantId,
      );
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async createDraftScoped(input: ReceiptDraftInput) {
    const body = toCreateDraftRequest(input);
    const record = mapApiReceipt(
      parseApiGoodsReceipt(
        await backendFetch<unknown>("/purchasing/receipts", {
          method: "POST",
          body,
        }),
      ),
      input.tenantId,
    );
    this.emit(record.receipt, "created");
    return record;
  }

  async updateDraftScoped(
    id: string,
    input: Omit<ReceiptDraftInput, "purchaseOrderId">,
  ) {
    assertApiUuid(id, "receiptId");
    const body = toUpdateDraftRequest(input);
    const record = mapApiReceipt(
      parseApiGoodsReceipt(
        await backendFetch<unknown>(`/purchasing/receipts/${id}`, {
          method: "PUT",
          body,
        }),
      ),
      input.tenantId,
    );
    this.emit(record.receipt, "updated");
    return record;
  }

  async deleteDraftScoped(tenantId: string, id: string) {
    assertApiUuid(id, "receiptId");
    await backendFetch<void>(`/purchasing/receipts/${id}`, { method: "DELETE" });
    this.eventBus.emit("receipt.changed", { entityId: id, tenantId, action: "deleted" });
  }

  async confirmDraftScoped(tenantId: string, id: string) {
    assertApiUuid(id, "receiptId");
    const record = mapApiReceipt(
      parseApiGoodsReceipt(
        await backendFetch<unknown>(`/purchasing/receipts/${id}/confirm`, {
          method: "POST",
        }),
      ),
      tenantId,
    );
    this.eventBus.emit("receipt.changed", {
      entityId: record.receipt.id,
      tenantId,
      branchId: record.receipt.branchId,
      action: "status_changed",
    });
    this.eventBus.emit("purchase-order.changed", {
      entityId: record.receipt.purchaseOrderId,
      tenantId,
      branchId: record.receipt.branchId,
      action: "status_changed",
    });
    const inventoryPayload = {
      entityId: record.receipt.id,
      tenantId,
      branchId: record.receipt.branchId,
      action: "updated" as const,
    };
    this.eventBus.emit("inventory.changed", inventoryPayload);
    this.eventBus.emit("stock.changed", inventoryPayload);
    return record;
  }

  async listIncidentsScoped(
    _tenantId: string,
    receiptId: string,
    params: { page: number; pageSize: number },
  ) {
    assertApiUuid(receiptId, "receiptId");
    assertPage(params.page, params.pageSize);
    const page = parseApiReceiptIncidentPage(
      await backendFetch<unknown>(`/purchasing/receipts/${receiptId}/incidents`, {
        query: { page: params.page, size: params.pageSize },
      }),
    );
    return {
      ...page,
      items: page.items.map(mapApiReceiptIncident),
    };
  }

  async createIncidentScoped(input: CreateReceiptIncidentScopedInput) {
    assertApiUuid(input.receiptId, "receiptId");
    const body = parseReceiptIncidentCreateRequest({
      incidentType: input.incidentType,
      goodsReceiptItemId: input.goodsReceiptItemId ?? null,
      quantityAffected: input.quantityAffected ?? null,
      notes: input.notes,
    });
    const incident = mapApiReceiptIncident(
      parseApiReceiptIncident(
        await backendFetch<unknown>(`/purchasing/receipts/${input.receiptId}/incidents`, {
          method: "POST",
          body,
        }),
      ),
    );
    this.eventBus.emit("receipt.changed", {
      entityId: input.receiptId,
      tenantId: input.tenantId,
      branchId: incident.branchId,
      incidentId: incident.id,
      action: "updated",
    });
    return incident;
  }

  async resolveIncidentScoped(tenantId: string, incidentId: string) {
    assertApiUuid(incidentId, "incidentId");
    const incident = mapApiReceiptIncident(
      parseApiReceiptIncident(
        await backendFetch<unknown>(`/purchasing/receipts/incidents/${incidentId}/resolve`, {
          method: "PATCH",
        }),
      ),
    );
    this.eventBus.emit("receipt.changed", {
      entityId: incident.goodsReceiptId,
      tenantId,
      branchId: incident.branchId,
      incidentId: incident.id,
      action: "updated",
    });
    return incident;
  }

  async resolveIncidentWithReplacementScoped(input: ResolveReceiptIncidentWithReplacementInput) {
    assertApiUuid(input.incidentId, "incidentId");
    assertApiUuid(input.receiptId, "receiptId");
    const body = parseResolveWithReplacementRequest({
      replacementQuantity: input.replacementQuantity,
      ...(input.trackingDetails && input.trackingDetails.length > 0
        ? {
            trackingDetails: input.trackingDetails.map((detail) => ({
              baseQuantity: detail.baseQuantity,
              lotNumber: detail.lotNumber?.trim() || null,
              expirationDate: detail.expirationDate || null,
              serialNumbers: detail.serialNumbers.map((serial) => serial.trim()).filter(Boolean),
            })),
          }
        : {}),
    });
    // La respuesta no es fuente de verdad: el llamador relee el receipt e incidencias.
    await backendFetch<unknown>(
      `/purchasing/receipts/incidents/${input.incidentId}/resolve-with-replacement`,
      { method: "POST", body },
    );
    this.eventBus.emit("receipt.changed", {
      entityId: input.receiptId,
      tenantId: input.tenantId,
      incidentId: input.incidentId,
      action: "updated",
    });
  }

  async validateSerialNumbersScoped(
    input: ValidateSerialNumbersInput,
  ): Promise<SerialValidationResult> {
    assertApiUuid(input.productId, "productId");
    return parseApiSerialValidation(
      await backendFetch<unknown>("/inventory/serials/validate", {
        method: "POST",
        body: { productId: input.productId, serialNumbers: input.serialNumbers },
      }),
    );
  }

  private emit(receipt: Receipt, action: "created" | "updated") {
    this.eventBus.emit("receipt.changed", {
      entityId: receipt.id,
      tenantId: receipt.tenantId,
      branchId: receipt.branchId,
      action,
    });
  }
}

export function mapApiReceiptIncident(api: ApiReceiptIncident): ReceiptIncidentRecord {
  return {
    id: api.id,
    branchId: api.branchId,
    goodsReceiptId: api.goodsReceiptId,
    ...(api.goodsReceiptItemId ? { goodsReceiptItemId: api.goodsReceiptItemId } : {}),
    incidentType: api.incidentType,
    status: api.status,
    ...(api.quantityAffected !== null ? { quantityAffected: api.quantityAffected } : {}),
    notes: api.notes,
    createdByUserId: api.createdByUserId,
    ...(api.resolvedByUserId ? { resolvedByUserId: api.resolvedByUserId } : {}),
    ...(api.resolvedAt ? { resolvedAt: api.resolvedAt } : {}),
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

export function mapApiReceipt(api: ApiGoodsReceipt, tenantId: string): ReceiptRecord {
  const receipt: Receipt = {
    id: api.id,
    tenantId,
    branchId: api.branchId,
    number: api.number,
    purchaseOrderId: api.purchaseOrderId,
    // `confirmed` significa que este documento ya fue recibido. El backend no expone aqui si
    // la orden completa quedo parcial o totalmente recibida; esa distincion sale de la PO.
    status: api.status === "draft" ? ReceiptStatus.in_progress : ReceiptStatus.received,
    receivedByUserId: api.receivedByUserId ?? undefined,
    receivedAt: api.receivedAt ?? undefined,
    notes: api.notes ?? undefined,
    ...(api.totalReceivedQuantity !== undefined
      ? { totalReceivedQuantity: api.totalReceivedQuantity }
      : {}),
    ...(api.incidentCount !== undefined ? { incidentCount: api.incidentCount } : {}),
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
  return {
    receipt,
    purchaseOrderNumber: api.purchaseOrderNumber ?? undefined,
    items: api.items.map((item) => {
      const singleTrackingDetail = item.trackingDetails.length === 1
        ? item.trackingDetails[0]
        : undefined;
      return {
        line: {
          id: item.id,
          receiptId: api.id,
          productId: item.productId,
          receivedQuantity: item.receivedQuantity,
          inventoryQuantity: item.baseQuantity,
          status:
            api.status === "confirmed" ? ReceiptLineStatus.complete : ReceiptLineStatus.partial,
          locationId: item.locationId ?? undefined,
          // El modelo legacy representa un solo lote por linea. Solo se proyecta cuando la
          // respuesta contiene exactamente un detalle; el array completo siempre se conserva.
          lotNumber: singleTrackingDetail?.lotNumber ?? undefined,
          expirationDate: singleTrackingDetail?.expirationDate ?? undefined,
          serialNumbers: singleTrackingDetail?.serialNumbers,
        },
        purchaseOrderItemId: item.purchaseOrderItemId,
        productNameSnapshot: item.productNameSnapshot ?? undefined,
        productSkuSnapshot: item.productSkuSnapshot ?? undefined,
        unitId: item.unitId,
        unitSymbolSnapshot: item.unitSymbolSnapshot,
        purchaseToBaseFactor: item.purchaseToBaseFactor,
        unitCost: item.unitCost,
        trackingDetails: item.trackingDetails.map((detail) => ({
          baseQuantity: detail.baseQuantity,
          lotNumber: detail.lotNumber ?? undefined,
          expirationDate: detail.expirationDate ?? undefined,
          serialNumbers: detail.serialNumbers,
        })),
      };
    }),
  };
}

export function toCreateDraftRequest(input: ReceiptDraftInput) {
  assertApiUuid(input.purchaseOrderId, "purchaseOrderId");
  return parseGoodsReceiptCreateRequest({
    purchaseOrderId: input.purchaseOrderId,
    notes: input.notes?.trim() || null,
    items: toDraftItems(input),
  });
}

export function toUpdateDraftRequest(input: Omit<ReceiptDraftInput, "purchaseOrderId">) {
  return parseGoodsReceiptUpdateRequest({
    notes: input.notes?.trim() || null,
    items: toDraftItems(input),
  });
}

function toDraftItems(input: Pick<ReceiptDraftInput, "items">) {
  return input.items.map((item) => ({
    purchaseOrderItemId: item.purchaseOrderItemId,
    receivedQuantity: item.receivedQuantity,
    locationId: item.locationId || null,
    trackingDetails: item.trackingDetails.map((detail) => ({
      baseQuantity: detail.baseQuantity,
      lotNumber: detail.lotNumber?.trim() || null,
      expirationDate: detail.expirationDate || null,
      serialNumbers: detail.serialNumbers.map((serial) => serial.trim()).filter(Boolean),
    })),
  }));
}

function assertPage(page: number, pageSize: number) {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new BackendRequestError("page debe comenzar en 1.", 400, "INVALID_PAGE");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BackendRequestError(
      "pageSize debe estar entre 1 y 100.",
      400,
      "INVALID_PAGE_SIZE",
    );
  }
}

function unsupportedOperation(): Promise<never> {
  return Promise.reject(
    new BackendRequestError(
      "Esta operacion legacy de recepciones no esta disponible por API.",
      501,
      "NOT_SUPPORTED",
    ),
  );
}
