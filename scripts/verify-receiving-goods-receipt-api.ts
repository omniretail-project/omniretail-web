import assert from "node:assert/strict";
import { PurchaseOrderStatus, ReceiptLineStatus, ReceiptStatus } from "@/core/enums";
import type {
  ReceiptDraftInput,
  ReceiptRecord,
  ReceiptRepository,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockReceiptRepository } from "@/infrastructure/mock/repositories/MockReceiptRepository";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import {
  ApiReceiptRepository,
  mapApiReceipt,
  toCreateDraftRequest,
  toUpdateDraftRequest,
} from "@/infrastructure/api/repositories/ApiReceiptRepository";
import {
  parseApiGoodsReceipt,
  parseApiGoodsReceiptPage,
} from "@/infrastructure/api/repositories/receiptApi.schema";
import {
  assertSingleLotDraftEditable,
  isApiReceivingReadOnly,
  isReceiptHistoryIncomplete,
  persistApiDraftWithHistoryGuard,
  toBaseQuantity,
  updateCanonicalDraft,
} from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import { nextReceivingStream } from "@/modules/receiving/application/services/ReceivingDocumentsService";
import { ReceivingServiceError } from "@/modules/receiving/application/services/serviceHelpers";
import type {
  ReceivingDocumentRow,
  ReceivingPaginationState,
  ReceivingReadModel,
} from "@/modules/receiving/application/dto/ReceivingDocumentsDto";
import {
  mergeReceivingDocuments,
  mergeReceivingReadModels,
  shouldReplaceReceivingBranch,
} from "@/modules/receiving/hooks/useReceivingDocuments";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const BRANCH_ID = "22222222-2222-2222-2222-222222222222";
const ORDER_ID = "33333333-3333-3333-3333-333333333333";
const ORDER_ITEM_ID = "44444444-4444-4444-4444-444444444444";
const RECEIPT_ID = "55555555-5555-5555-5555-555555555555";
const RECEIPT_ITEM_ID = "66666666-6666-6666-6666-666666666666";
const PRODUCT_ID = "77777777-7777-7777-7777-777777777777";
const UNIT_ID = "88888888-8888-8888-8888-888888888888";
const LOCATION_ID = "99999999-9999-9999-9999-999999999999";
const NOW = "2026-10-02T12:00:00.000Z";

type PaginatedReceivingReadModel = ReceivingReadModel & {
  pagination: ReceivingPaginationState;
};

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

const API_RECEIPT = {
  id: RECEIPT_ID,
  branchId: BRANCH_ID,
  purchaseOrderId: ORDER_ID,
  purchaseOrderNumber: "OC-0001",
  number: "REC-0001",
  status: "draft",
  receivedAt: null,
  notes: null,
  receivedByUserId: null,
  createdAt: NOW,
  updatedAt: NOW,
  items: [
    {
      id: RECEIPT_ITEM_ID,
      purchaseOrderItemId: ORDER_ITEM_ID,
      productId: PRODUCT_ID,
      productNameSnapshot: "Producto trazable",
      productSkuSnapshot: "SKU-1",
      receivedQuantity: "2.5",
      unitId: UNIT_ID,
      unitSymbolSnapshot: "caja",
      purchaseToBaseFactor: "4",
      baseQuantity: "10",
      locationId: LOCATION_ID,
      unitCost: "12.50",
      trackingDetails: [
        {
          baseQuantity: "10",
          lotNumber: "LOTE-1",
          expirationDate: "2027-10-02",
          serialNumbers: [],
        },
      ],
    },
  ],
};

function verifySchemasAndMapping() {
  const parsed = parseApiGoodsReceipt(API_RECEIPT);
  assert.equal(parsed.items[0].receivedQuantity, 2.5);
  assert.equal(parsed.items[0].baseQuantity, 10);

  const page = parseApiGoodsReceiptPage({
    items: [API_RECEIPT],
    page: 1,
    pageSize: 25,
    totalItems: 51,
    totalPages: 3,
  });
  assert.equal(page.totalItems, 51);
  assert.equal(page.totalPages, 3);

  const mapped = mapApiReceipt(parsed, TENANT_ID);
  assert.equal(mapped.receipt.tenantId, TENANT_ID);
  assert.equal(mapped.items[0].line.receivedQuantity, 2.5);
  assert.equal(mapped.items[0].line.inventoryQuantity, 10);
  assert.equal(mapped.items[0].trackingDetails[0].lotNumber, "LOTE-1");
  assert.equal("confirmationId" in mapped.receipt, false);
  assert.equal("confirmationFingerprint" in mapped.receipt, false);

  assert.throws(
    () => parseApiGoodsReceipt({ ...API_RECEIPT, id: "mock-receipt" }),
    BackendRequestError,
  );
}

async function verifyMultiLotSafety() {
  const parsed = parseApiGoodsReceipt({
    ...API_RECEIPT,
    items: [
      {
        ...API_RECEIPT.items[0],
        trackingDetails: [
          API_RECEIPT.items[0].trackingDetails[0],
          {
            baseQuantity: "4",
            lotNumber: "LOTE-2",
            expirationDate: "2027-11-02",
            serialNumbers: [],
          },
        ],
      },
    ],
  });
  const mapped = mapApiReceipt(parsed, TENANT_ID);

  assert.equal(mapped.items[0].trackingDetails.length, 2);
  assert.equal(mapped.items[0].trackingDetails[1].lotNumber, "LOTE-2");
  assert.equal(mapped.items[0].line.lotNumber, undefined);

  // Contrato vigente (7A2): el editor conserva trackingDetails[], asi que un borrador multi-lote SI
  // llega al PUT con todos sus detalles (7A1 lo bloqueaba; ya no).
  let putCalls = 0;
  const payloads: Array<Omit<ReceiptDraftInput, "purchaseOrderId">> = [];
  const multiLotInput: Omit<ReceiptDraftInput, "purchaseOrderId"> = {
    tenantId: TENANT_ID,
    items: [
      {
        ...draftInput(true).items[0],
        trackingDetails: [
          {
            baseQuantity: 6,
            lotNumber: " LOTE-1 ",
            expirationDate: "2027-10-02",
            serialNumbers: [],
          },
          {
            baseQuantity: 4,
            lotNumber: " LOTE-2 ",
            expirationDate: "2027-11-02",
            serialNumbers: [],
          },
        ],
      },
    ],
  };
  const multiLotRepository = {
    getRecordByIdScoped: async () => mapped,
    updateDraftScoped: async (
      _id: string,
      input: Omit<ReceiptDraftInput, "purchaseOrderId">,
    ) => {
      putCalls += 1;
      payloads.push(input);
      return mapped;
    },
  };
  assert.doesNotThrow(() => assertSingleLotDraftEditable(mapped));
  await updateCanonicalDraft(multiLotRepository, TENANT_ID, ORDER_ID, RECEIPT_ID, multiLotInput);
  assert.equal(putCalls, 1, "un borrador multi-lote debe llegar al PUT");
  assert.equal(payloads[0].items[0].trackingDetails.length, 2);
  assert.deepEqual(
    payloads[0].items[0].trackingDetails.map((detail) => detail.baseQuantity),
    [6, 4],
  );
  // El request al backend conserva ambos lotes (y normaliza los espacios).
  const request = toUpdateDraftRequest(multiLotInput);
  assert.deepEqual(
    request.items[0].trackingDetails.map((detail) => detail.lotNumber),
    ["LOTE-1", "LOTE-2"],
  );

  // La validacion del registro canonico sigue vigente: otra orden no llega al PUT.
  await assert.rejects(
    updateCanonicalDraft(
      multiLotRepository,
      TENANT_ID,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      RECEIPT_ID,
      multiLotInput,
    ),
    ReceivingServiceError,
  );
  assert.equal(putCalls, 1, "un borrador de otra orden no debe llegar al PUT");

  const singleLot = mapApiReceipt(parseApiGoodsReceipt(API_RECEIPT), TENANT_ID);
  assert.doesNotThrow(() => assertSingleLotDraftEditable(singleLot));
  const singleLotRepository = {
    getRecordByIdScoped: async () => singleLot,
    updateDraftScoped: async () => {
      putCalls += 1;
      return singleLot;
    },
  };
  await updateCanonicalDraft(
    singleLotRepository,
    TENANT_ID,
    ORDER_ID,
    RECEIPT_ID,
    { tenantId: TENANT_ID, items: draftInput(true).items },
  );
  assert.equal(putCalls, 2, "un borrador single-lot debe conservar su PUT");
}

async function verifyIncompleteReceiptHistorySafety() {
  const singleLot = mapApiReceipt(parseApiGoodsReceipt(API_RECEIPT), TENANT_ID);
  const input: Omit<ReceiptDraftInput, "purchaseOrderId"> = {
    tenantId: TENANT_ID,
    items: draftInput(true).items,
  };
  let draftRecords: ReceiptRecord[] = [singleLot];
  let confirmedTotalPages = 2;
  let postCalls = 0;
  let putCalls = 0;
  const repository: Pick<
    ReceiptRepository,
    | "getPageScoped"
    | "getRecordByIdScoped"
    | "createDraftScoped"
    | "updateDraftScoped"
  > = {
    getPageScoped: async (_tenantId, params) => {
      if (params.status === "draft") {
        return {
          items: draftRecords,
          page: 1,
          pageSize: 2,
          totalItems: draftRecords.length,
          totalPages: 1,
        };
      }
      return {
        items: [],
        page: 1,
        pageSize: 100,
        totalItems: confirmedTotalPages > 1 ? 101 : 1,
        totalPages: confirmedTotalPages,
      };
    },
    getRecordByIdScoped: async () => singleLot,
    createDraftScoped: async () => {
      postCalls += 1;
      return singleLot;
    },
    updateDraftScoped: async () => {
      putCalls += 1;
      return singleLot;
    },
  };

  assert.equal(isReceiptHistoryIncomplete(1, confirmedTotalPages), true);
  assert.equal(
    isApiReceivingReadOnly(PurchaseOrderStatus.approved, false, true),
    true,
    "un detalle con historial incompleto debe ser read-only",
  );
  await assert.rejects(
    persistApiDraftWithHistoryGuard(
      repository,
      TENANT_ID,
      BRANCH_ID,
      ORDER_ID,
      input,
    ),
    ReceivingServiceError,
  );
  assert.equal(putCalls, 0, "el historial incompleto debe bloquear el PUT");
  assert.equal(postCalls, 0, "el historial incompleto no debe ejecutar POST");

  draftRecords = [];
  await assert.rejects(
    persistApiDraftWithHistoryGuard(
      repository,
      TENANT_ID,
      BRANCH_ID,
      ORDER_ID,
      input,
    ),
    ReceivingServiceError,
  );
  assert.equal(postCalls, 0, "el historial incompleto debe bloquear también el POST");
  assert.equal(putCalls, 0, "el preflight incompleto no debe ejecutar ninguna escritura");

  confirmedTotalPages = 1;
  draftRecords = [singleLot];
  assert.equal(isReceiptHistoryIncomplete(1, confirmedTotalPages), false);
  assert.equal(
    isApiReceivingReadOnly(PurchaseOrderStatus.approved, false, false),
    false,
    "un borrador single-lot con historial completo debe seguir editable",
  );
  await persistApiDraftWithHistoryGuard(
    repository,
    TENANT_ID,
    BRANCH_ID,
    ORDER_ID,
    input,
  );
  assert.equal(putCalls, 1, "single-lot con historial completo debe conservar su PUT");
  assert.equal(postCalls, 0);
}

async function verifyIncrementalPaginationHelpers() {
  const pageOne: PaginatedReceivingReadModel = {
    documents: [receivingRow("row-order-1", "order-1", "2026-10-01T10:00:00.000Z")],
    incidents: [],
    incidentTypes: [],
    pagination: {
      branchId: BRANCH_ID,
      streams: {
        approved: { currentPage: 1, totalPages: 2 },
        sent: { currentPage: 1, totalPages: 1 },
        partially_received: { currentPage: 1, totalPages: 1 },
        received: { currentPage: 1, totalPages: 1 },
      },
      hasMore: true,
      receiptHistoryIncomplete: false,
    },
  };
  const pageTwo: PaginatedReceivingReadModel = {
    documents: [
      receivingRow("row-order-1-new", "order-1", "2026-10-02T10:00:00.000Z"),
      receivingRow("row-order-2", "order-2", "2026-10-01T12:00:00.000Z"),
    ],
    incidents: [],
    incidentTypes: [],
    pagination: {
      branchId: BRANCH_ID,
      streams: {
        approved: { currentPage: 2, totalPages: 2 },
        sent: { currentPage: 1, totalPages: 1 },
        partially_received: { currentPage: 1, totalPages: 1 },
        received: { currentPage: 1, totalPages: 1 },
      },
      hasMore: false,
      receiptHistoryIncomplete: true,
    },
  };

  assert.equal(nextReceivingStream(pageOne.pagination), "approved");
  assert.equal(
    nextReceivingStream({
      ...pageOne.pagination,
      streams: {
        ...pageOne.pagination.streams,
        approved: { currentPage: 2, totalPages: 2 },
        sent: { currentPage: 1, totalPages: 2 },
      },
    }),
    "sent",
  );
  assert.equal(nextReceivingStream(pageTwo.pagination), null);
  const merged = mergeReceivingDocuments(pageOne.documents, pageTwo.documents);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].documentId, "order-1");
  assert.equal(merged[0].id, "row-order-1-new");
  const keepsNewest = mergeReceivingDocuments(
    [pageTwo.documents[0]],
    [pageOne.documents[0]],
  );
  assert.equal(keepsNewest[0].id, "row-order-1-new");
  assert.equal(pageTwo.pagination.hasMore, false);
  assert.equal(pageTwo.pagination.receiptHistoryIncomplete, true);

  const otherBranch: PaginatedReceivingReadModel = {
    ...pageTwo,
    pagination: { ...pageTwo.pagination, branchId: "branch-b" },
  };
  assert.equal(
    shouldReplaceReceivingBranch(
      pageOne.pagination.branchId,
      otherBranch.pagination.branchId,
    ),
    true,
  );
  const switched = mergeReceivingReadModels(pageOne, otherBranch);
  assert.deepEqual(switched.documents, otherBranch.documents);

  let attempts = 0;
  let accumulated: ReceivingReadModel = pageOne;
  const requestNextPage = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("fallo incremental esperado");
    return pageTwo;
  };
  await assert.rejects(async () => {
    accumulated = mergeReceivingReadModels(accumulated, await requestNextPage());
  });
  assert.deepEqual(accumulated.documents, pageOne.documents);
  accumulated = mergeReceivingReadModels(accumulated, await requestNextPage());
  assert.equal(attempts, 2);
  assert.equal(accumulated.documents.length, 2);
}

function receivingRow(
  id: string,
  documentId: string,
  lastUpdatedAt: string,
): ReceivingDocumentRow {
  return {
    id,
    documentId,
    documentNumber: `OC-${documentId}`,
    documentType: "purchase_order",
    documentTypeLabel: "Orden",
    supplierOrSource: "Proveedor",
    productCount: 1,
    requestedQuantity: 10,
    receivedQuantity: 0,
    status: "pending",
    statusLabel: "Pendiente",
    lastUpdatedAt,
    searchText: documentId,
  };
}

function draftInput(tracked: boolean): ReceiptDraftInput {
  return {
    tenantId: TENANT_ID,
    purchaseOrderId: ORDER_ID,
    notes: "  Borrador  ",
    items: [
      {
        purchaseOrderItemId: ORDER_ITEM_ID,
        receivedQuantity: 2.5,
        locationId: LOCATION_ID,
        trackingDetails: tracked
          ? [
              {
                baseQuantity: 10,
                lotNumber: " LOTE-1 ",
                expirationDate: "2027-10-02",
                serialNumbers: [],
              },
            ]
          : [],
      },
    ],
  };
}

function verifyDraftRequestsAndQuantities() {
  const create = toCreateDraftRequest(draftInput(true));
  assert.equal(create.purchaseOrderId, ORDER_ID);
  assert.equal(create.notes, "Borrador");
  assert.equal(create.items[0].receivedQuantity, 2.5);
  assert.equal(create.items[0].trackingDetails[0].baseQuantity, 10);
  assert.equal(create.items[0].trackingDetails[0].lotNumber, "LOTE-1");

  const update = toUpdateDraftRequest({
    tenantId: TENANT_ID,
    notes: "Actualizado",
    items: draftInput(true).items,
  });
  assert.equal("purchaseOrderId" in update, false);
  assert.equal(update.notes, "Actualizado");

  const nontrace = toCreateDraftRequest(draftInput(false));
  assert.deepEqual(nontrace.items[0].trackingDetails, []);

  assert.equal(
    toBaseQuantity({ purchaseToBaseFactor: 4 }, 2.5),
    10,
  );
}

async function verifyHttpOperationsAndNoFallback() {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const responses: Response[] = [
    jsonResponse({ items: [API_RECEIPT], page: 1, pageSize: 25, totalItems: 51, totalPages: 3 }),
    jsonResponse({ items: [API_RECEIPT], page: 2, pageSize: 25, totalItems: 51, totalPages: 3 }),
    jsonResponse(API_RECEIPT, 201),
    jsonResponse({ ...API_RECEIPT, notes: "Actualizado" }),
    new Response(undefined, { status: 204 }),
    jsonResponse({ message: "Fallo real" }, 500),
  ];
  globalThis.fetch = async (request, init) => {
    requests.push({
      url: String(request),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const response = responses.shift();
    if (!response) throw new Error("Respuesta HTTP de prueba no configurada.");
    return response;
  };

  try {
    const events: string[] = [];
    const eventBus = new DataEventBus();
    eventBus.subscribe("receipt.changed", (payload) => events.push(payload.action ?? ""));
    const repository = new ApiReceiptRepository(eventBus);

    const firstPage = await repository.getPageScoped(TENANT_ID, {
      branchId: BRANCH_ID,
      page: 1,
      pageSize: 25,
    });
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.totalPages, 3);
    assert.match(requests[0].url, /page=1/);

    const page = await repository.getPageScoped(TENANT_ID, {
      branchId: BRANCH_ID,
      page: 2,
      pageSize: 25,
    });
    assert.equal(page.page, 2);
    assert.equal(page.totalItems, 51);
    assert.match(requests[1].url, /page=2/);
    assert.match(requests[1].url, /size=25/);
    assert.equal(requests.length, 2, "cada pagina debe producir un solo request");

    await repository.createDraftScoped(draftInput(true));
    assert.equal(requests[2].method, "POST");
    assert.deepEqual(requests[2].body, toCreateDraftRequest(draftInput(true)));

    await repository.updateDraftScoped(RECEIPT_ID, {
      tenantId: TENANT_ID,
      notes: "Actualizado",
      items: draftInput(true).items,
    });
    assert.equal(requests[3].method, "PUT");
    assert.equal(requests[3].url.endsWith(`/purchasing/receipts/${RECEIPT_ID}`), true);
    const updateBody = requests[3].body;
    assert.ok(typeof updateBody === "object" && updateBody !== null);
    assert.equal("purchaseOrderId" in updateBody, false);

    await repository.deleteDraftScoped(TENANT_ID, RECEIPT_ID);
    assert.equal(requests[4].method, "DELETE");
    assert.deepEqual(events, ["created", "updated", "deleted"]);

    await assert.rejects(
      repository.getPageScoped(TENANT_ID, { page: 1, pageSize: 25 }),
      (error: unknown) => error instanceof BackendRequestError && error.status === 500,
    );
    assert.equal(requests.length, 6, "un fallo API no debe iniciar una lectura mock alternativa");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyLegacyMockFlowRemainsAvailable() {
  const eventBus = new DataEventBus();
  const repository = new MockReceiptRepository(
    new MockDatabaseStore(new MemoryStorageAdapter()),
    eventBus,
  );
  const created = await repository.create({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
    number: "REC-MOCK-COMPAT",
    purchaseOrderId: "purchase-order-001",
    status: ReceiptStatus.in_progress,
  });
  const lines = await repository.replaceLines(created.id, [
    {
      productId: "prod-hammer",
      receivedQuantity: 1,
      status: ReceiptLineStatus.partial,
    },
  ]);
  assert.equal((await repository.getById(created.id))?.number, "REC-MOCK-COMPAT");
  assert.equal(lines.length, 1);
  assert.equal((await repository.getLinesByReceipt(created.id)).length, 1);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function main() {
  verifySchemasAndMapping();
  await verifyMultiLotSafety();
  await verifyIncompleteReceiptHistorySafety();
  await verifyIncrementalPaginationHelpers();
  verifyDraftRequestsAndQuantities();
  await verifyHttpOperationsAndNoFallback();
  await verifyLegacyMockFlowRemainsAvailable();
  console.log("Goods Receipt API foundation verification passed.");
}

void main();
