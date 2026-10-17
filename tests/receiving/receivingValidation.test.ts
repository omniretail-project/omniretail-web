import { describe, expect, it, vi } from "vitest";
import { PurchaseOrderStatus, ReceiptStatus } from "@/core/enums";
import { EXPIRATION_BEFORE_ENTRY_MESSAGE } from "@/core/inventory/expirationDate";
import type { ReceiptRecord, ReceiptRepository } from "@/core/repositories";
import type { PaginatedResult } from "@/core/types/pagination.types";
import {
  getAcceptedNow,
  getIncidentCapacity,
  getRejectedNow,
  isApiReceivingReadOnly,
  isReceiptHistoryIncomplete,
  LOCATIONS_DISABLED_RECEIPT_BLOCK_MESSAGE,
  parseSerialNumbers,
  persistApiDraftWithHistoryGuard,
  toBaseQuantity,
  updateCanonicalDraft,
  validateApiDraftLines,
  validateIncidentQuantities,
  validateLines,
} from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import {
  capabilityFlags,
  documentIncident,
  paginated,
  receiptRecord,
  receivingLine,
  trackingDetail,
  ORDER_ID,
  RECEIPT_ID,
  TENANT_ID,
  BRANCH_ID,
} from "./receivingFixtures";

const OPERATION_DATE = "2026-06-15";

function detailFor(lines = [receivingLine()], multipleLocations = true) {
  return { lines, capabilities: capabilityFlags(multipleLocations) };
}

function validate(
  lines = [receivingLine()],
  canonical = lines,
  multipleLocations = true,
) {
  return validateApiDraftLines(lines, detailFor(canonical, multipleLocations), OPERATION_DATE);
}

const LOT = { stock: true, lot: true, expiration: false, serial: false };
const LOT_EXPIRATION = { stock: true, lot: true, expiration: true, serial: false };
const SERIAL = { stock: true, lot: false, expiration: false, serial: true };

describe("validateApiDraftLines quantities", () => {
  it("accepts a simple stock line received within the pending quantity", () => {
    expect(validate()).toEqual([]);
  });

  it("rejects a line that is not part of the current document and requires another line", () => {
    const foreign = receivingLine({ id: "line-x", sourceLineId: "line-x", productId: "other" });

    expect(validate([foreign], [receivingLine()])).toEqual([
      "Una línea recibida no pertenece al documento actual.",
      "Ingresa al menos una cantidad recibida para continuar.",
    ]);
  });

  it("skips blank and zero lines but still demands at least one quantity", () => {
    const lines = [receivingLine({ receivedNow: "" }), receivingLine({ receivedNow: 0 })];

    expect(validate([lines[0]], [lines[0]])).toEqual([
      "Ingresa al menos una cantidad recibida para continuar.",
    ]);
    expect(validate([lines[1]], [lines[1]])).toEqual([
      "Ingresa al menos una cantidad recibida para continuar.",
    ]);
  });

  it("rejects negative quantities and fractions for whole units", () => {
    expect(validate([receivingLine({ receivedNow: -1 })])).toEqual([
      "Producto 1: la cantidad recibida debe ser un entero positivo.",
    ]);
    expect(validate([receivingLine({ receivedNow: 1.5 })])).toEqual([
      "Producto 1: la cantidad recibida debe ser un entero positivo.",
    ]);
  });

  it("allows up to three decimals only when the unit accepts them", () => {
    const decimal = (receivedNow: number) =>
      receivingLine({ unitAllowsDecimals: true, receivedNow });

    expect(validate([decimal(1.234)])).toEqual([]);
    expect(validate([decimal(1.2345)])).toEqual([
      "Producto 1: la cantidad recibida debe ser positiva y admitir hasta 3 decimales.",
    ]);
  });

  it("limits the quantity by the order remainder after previous receipts", () => {
    const line = receivingLine({ orderedQuantity: 10, acceptedPreviously: 4, receivedNow: 7 });

    expect(validate([line])).toEqual(["Producto 1: la cantidad recibida no puede superar 6."]);
    expect(validate([{ ...line, receivedNow: 6 }])).toEqual([]);
  });

  it("rejects quantities above the safe inventory maximum", () => {
    const line = receivingLine({ orderedQuantity: 2_000_000, receivedNow: 1_000_000 });

    expect(validate([line])).toEqual([
      "Producto 1: la cantidad recibida supera el máximo permitido.",
    ]);
  });

  it("keeps the quantity rules independent for each line", () => {
    const first = receivingLine({ receivedNow: 11 });
    const second = receivingLine({
      id: "line-2",
      sourceLineId: "line-2",
      productId: "product-2",
      productName: "Producto 2",
      receivedNow: 1.5,
    });

    expect(validate([first, second])).toEqual([
      "Producto 1: la cantidad recibida no puede superar 10.",
      "Producto 2: la cantidad recibida debe ser un entero positivo.",
    ]);
  });
});

describe("validateApiDraftLines tracking details", () => {
  const lot = (overrides = {}) =>
    receivingLine({
      tracking: LOT,
      trackingDetails: [trackingDetail({ baseQuantity: 2, lotNumber: "L-1" })],
      ...overrides,
    });

  it("accepts a lot line whose details add up to the received base quantity", () => {
    expect(validate([lot()])).toEqual([]);
  });

  it("converts purchase units to base units before comparing the tracked sum", () => {
    const line = lot({
      purchaseToBaseFactor: 12,
      trackingDetails: [trackingDetail({ baseQuantity: 24, lotNumber: "L-1" })],
    });

    expect(validate([line])).toEqual([]);
    expect(
      validate([
        lot({
          purchaseToBaseFactor: 12,
          trackingDetails: [trackingDetail({ baseQuantity: 20, lotNumber: "L-1" })],
        }),
      ]),
    ).toEqual(["Producto 1: la suma de cantidades base debe ser 24."]);
  });

  it("requires tracking details for lot or serial products and rejects them otherwise", () => {
    expect(validate([lot({ trackingDetails: [] })])).toEqual([
      "Producto 1: agrega al menos un detalle de trazabilidad.",
    ]);
    expect(
      validate([receivingLine({ trackingDetails: [trackingDetail({ lotNumber: "L-1" })] })]),
    ).toEqual(["Producto 1: el producto no utiliza detalle de lote o serie."]);
  });

  it("requires a lot number and forbids repeating it between details", () => {
    expect(
      validate([lot({ trackingDetails: [trackingDetail({ baseQuantity: 2, lotNumber: "  " })] })]),
    ).toEqual(["Producto 1, detalle 1: ingresa el número de lote."]);
    expect(
      validate([
        lot({
          trackingDetails: [
            trackingDetail({ id: "t-1", baseQuantity: 1, lotNumber: "L-1" }),
            trackingDetail({ id: "t-2", baseQuantity: 1, lotNumber: "L-1" }),
          ],
        }),
      ]),
    ).toEqual(["Producto 1: un lote no puede repetirse entre detalles."]);
  });

  it("rejects empty or non positive base quantities in a detail", () => {
    const errors = validate([
      lot({ trackingDetails: [trackingDetail({ baseQuantity: "", lotNumber: "L-1" })] }),
    ]);

    expect(errors).toContain(
      "Producto 1, detalle 1: la cantidad base debe ser positiva y admitir hasta 3 decimales.",
    );
    expect(errors).toContain("Producto 1: la suma de cantidades base debe ser 2.");
  });

  it("validates expiration dates against the operation date", () => {
    const withExpiration = (expirationDate: string) =>
      receivingLine({
        tracking: LOT_EXPIRATION,
        trackingDetails: [trackingDetail({ baseQuantity: 2, lotNumber: "L-1", expirationDate })],
      });

    expect(validate([withExpiration("")])).toEqual([
      "Producto 1, detalle 1: ingresa la fecha de vencimiento.",
    ]);
    expect(validate([withExpiration("2026-06-14")])).toEqual([
      `Producto 1, detalle 1: ${EXPIRATION_BEFORE_ENTRY_MESSAGE}`,
    ]);
    expect(validate([withExpiration(OPERATION_DATE)])).toEqual([]);
  });

  it("rejects an expiration date or lot data on products that do not use them", () => {
    expect(
      validate([
        lot({
          trackingDetails: [
            trackingDetail({ baseQuantity: 2, lotNumber: "L-1", expirationDate: "2027-01-01" }),
          ],
        }),
      ]),
    ).toEqual(["Producto 1, detalle 1: el producto no utiliza vencimiento."]);
    expect(
      validate([
        receivingLine({
          tracking: SERIAL,
          trackingDetails: [
            trackingDetail({ baseQuantity: 2, lotNumber: "L-1", serialNumbersText: "S-1\nS-2" }),
          ],
        }),
      ]),
    ).toEqual(["Producto 1, detalle 1: el producto no utiliza trazabilidad por lote."]);
  });
});

describe("validateApiDraftLines serial numbers", () => {
  const serial = (serialNumbersText: string, overrides = {}) =>
    receivingLine({
      tracking: SERIAL,
      trackingDetails: [trackingDetail({ baseQuantity: 2, serialNumbersText })],
      ...overrides,
    });

  it("accepts as many unique serial numbers as base units received", () => {
    expect(validate([serial("S-1\nS-2")])).toEqual([]);
    expect(validate([serial("S-1, S-2")])).toEqual([]);
  });

  it("rejects a serial count that differs from the base quantity", () => {
    expect(validate([serial("S-1")])).toEqual([
      "Producto 1, detalle 1: la cantidad base debe ser entera y coincidir con sus números de serie.",
    ]);
  });

  it("rejects repeated serial numbers inside the same detail", () => {
    expect(validate([serial("S-1\nS-1")])).toEqual([
      "Producto 1, detalle 1: los números de serie no pueden repetirse.",
    ]);
  });

  it("rejects serial numbers longer than 100 characters", () => {
    expect(validate([serial(`${"S".repeat(101)}\nS-2`)])).toEqual([
      "Producto 1, detalle 1: cada número de serie admite hasta 100 caracteres.",
    ]);
  });

  it("rejects the same serial number on different lines of the document", () => {
    const first = serial("S-1\nS-2");
    const second = serial("S-1\nS-3", {
      id: "line-2",
      sourceLineId: "line-2",
      productId: "product-2",
      productName: "Producto 2",
    });

    expect(validate([first, second])).toEqual([
      "Producto 2: el número de serie S-1 ya aparece en otra línea o detalle.",
    ]);
  });

  it("rejects serial numbers on a lot-only product", () => {
    expect(
      validate([
        receivingLine({
          tracking: LOT,
          trackingDetails: [
            trackingDetail({ baseQuantity: 2, lotNumber: "L-1", serialNumbersText: "S-1" }),
          ],
        }),
      ]),
    ).toEqual(["Producto 1, detalle 1: el producto no utiliza números de serie."]);
  });
});

describe("validateApiDraftLines location capability", () => {
  it("blocks stock lines when multiple locations are disabled", () => {
    expect(validate([receivingLine()], [receivingLine()], false)).toEqual([
      `Producto 1: ${LOCATIONS_DISABLED_RECEIPT_BLOCK_MESSAGE}`,
    ]);
  });
});

describe("validateIncidentQuantities", () => {
  const incidentTypes = [{ id: "damaged", name: "Dañado" }];

  it("accepts an editable incident that fits in the pending quantity", () => {
    expect(validateIncidentQuantities([receivingLine()], [documentIncident()])).toEqual([]);
  });

  it("ignores incidents that are not editable", () => {
    const resolved = documentIncident({
      editable: false,
      status: "resolved",
      productId: "unknown",
      quantityAffected: 999,
    });

    expect(validateIncidentQuantities([receivingLine()], [resolved])).toEqual([]);
  });

  it("requires a known product for every editable incident", () => {
    expect(
      validateIncidentQuantities([receivingLine()], [documentIncident({ productId: "other" })]),
    ).toEqual(["Selecciona un producto valido para cada incidencia."]);
    expect(
      validateIncidentQuantities([receivingLine()], [documentIncident({ productId: undefined })]),
    ).toEqual(["Selecciona un producto valido para cada incidencia."]);
  });

  it("validates the incident type against the document catalog when it is provided", () => {
    const detail = { lines: [receivingLine()], incidentTypes };

    expect(validateIncidentQuantities([receivingLine()], [documentIncident()], detail)).toEqual([]);
    expect(
      validateIncidentQuantities(
        [receivingLine()],
        [documentIncident({ incidentTypeId: "unknown" })],
        detail,
      ),
    ).toEqual(["Producto 1: selecciona un tipo de incidencia valido."]);
    expect(
      validateIncidentQuantities([receivingLine()], [documentIncident({ incidentTypeId: "" })]),
    ).toEqual(["Producto 1: selecciona un tipo de incidencia valido."]);
  });

  it("requires a description of at most 500 characters", () => {
    expect(
      validateIncidentQuantities([receivingLine()], [documentIncident({ description: "  " })]),
    ).toEqual(["Producto 1: agrega la observacion de la incidencia."]);
    expect(
      validateIncidentQuantities(
        [receivingLine()],
        [documentIncident({ description: "x".repeat(501) })],
      ),
    ).toEqual(["Producto 1: la observacion admite hasta 500 caracteres."]);
  });

  it("requires a positive quantity within the safe maximum and unit compatibility", () => {
    const check = (quantityAffected: number | undefined) =>
      validateIncidentQuantities([receivingLine()], [documentIncident({ quantityAffected })]);

    expect(check(0)).toContain("Producto 1: la cantidad de la incidencia debe ser mayor que cero.");
    expect(check(undefined)).toContain(
      "Producto 1: la cantidad de la incidencia debe ser mayor que cero.",
    );
    expect(check(1_000_000)).toContain(
      "Producto 1: la cantidad de la incidencia no puede superar 999,999.99.",
    );
    expect(check(1.5)).toContain("Producto 1: la unidad no admite incidencias fraccionarias.");
  });

  it("reports the decimal limit for fractional units", () => {
    const line = receivingLine({ unitAllowsDecimals: true });

    expect(
      validateIncidentQuantities([line], [documentIncident({ quantityAffected: 1.2345 })]),
    ).toContain("Producto 1: la incidencia admite hasta 3 decimales.");
    expect(
      validateIncidentQuantities([line], [documentIncident({ quantityAffected: 1.234 })]),
    ).toEqual([]);
  });

  it("rejects accepted quantities that are not a finite number or are negative", () => {
    expect(validateIncidentQuantities([receivingLine({ receivedNow: "1." })], [])).toContain(
      "Producto 1: aceptado ahora no es valido.",
    );
    expect(validateIncidentQuantities([receivingLine({ receivedNow: -1 })], [])).toContain(
      "Producto 1: aceptado ahora debe estar entre 0 y 10.",
    );
  });

  it("rejects accepted quantities above what is still pending", () => {
    const line = receivingLine({ orderedQuantity: 10, acceptedPreviously: 4, receivedNow: 7 });

    expect(validateIncidentQuantities([line], [])).toContain(
      "Producto 1: aceptado ahora debe estar entre 0 y 6.",
    );
  });

  it("limits accepted plus incident quantities to the pending quantity", () => {
    const line = receivingLine({ receivedNow: 6 });
    const incident = documentIncident({ quantityAffected: 5 });

    expect(validateIncidentQuantities([line], [incident])).toEqual([
      "Producto 1: solo quedan 5 unidades disponibles para registrar entre aceptadas e incidencias.",
    ]);
  });

  it("applies the text limits of lot, serial and notes fields", () => {
    const line = receivingLine({
      lotNumber: "L".repeat(51),
      serialNumbersText: "S".repeat(5_001),
      notes: "n".repeat(501),
    });

    expect(validateIncidentQuantities([line], [])).toEqual([
      "Producto 1: el lote admite hasta 50 caracteres.",
      "Producto 1: las series admiten hasta 5,000 caracteres.",
      "Producto 1: las notas admiten hasta 500 caracteres.",
    ]);
  });
});

describe("validateLines", () => {
  type LineValidationContext = Parameters<typeof validateLines>[2];

  const legacyDetail = (
    lines = [receivingLine()],
    multipleLocations = true,
    dataSource: "mock" | "api" = "mock",
  ): LineValidationContext => ({
    document: {
      id: ORDER_ID,
      type: "purchase_order",
      number: "OC-001",
      typeLabel: "Orden de compra",
      originLabel: "Proveedor",
      originName: "Proveedor 1",
      branchId: BRANCH_ID,
      branchName: "Sucursal 1",
      tenantId: TENANT_ID,
      statusLabel: "Aprobada",
    },
    lines,
    incidentTypes: [{ id: "damaged", name: "Dañado" }],
    capabilities: capabilityFlags(multipleLocations),
    dataSource,
  });
  const asDetail = (detail: LineValidationContext) => detail;

  it("delegates API purchase orders to the API draft rules", () => {
    const line = receivingLine({ receivedNow: 1.5 });
    const detail = legacyDetail([line], true, "api");

    expect(validateLines([line], [], asDetail(detail), OPERATION_DATE)).toEqual([
      "Producto 1: la cantidad recibida debe ser un entero positivo.",
    ]);
  });

  it("rejects fractions on whole units in the mock flow", () => {
    const line = receivingLine({ receivedNow: 1.5 });

    expect(validateLines([line], [], asDetail(legacyDetail([line])), OPERATION_DATE)).toContain(
      "Producto 1: la unidad no admite fracciones.",
    );
  });

  it("requires lot, expiration and unique serial numbers for the accepted quantity", () => {
    const line = receivingLine({
      tracking: { stock: true, lot: true, expiration: true, serial: true },
      receivedNow: 2,
      serialNumbersText: "S-1\nS-1",
      lotNumber: "",
      expirationDate: "",
    });

    const errors = validateLines([line], [], asDetail(legacyDetail([line])), OPERATION_DATE);

    expect(errors).toContain("Producto 1: lote requerido.");
    expect(errors).toContain("Producto 1: fecha de vencimiento requerida.");
    expect(errors).toContain("Producto 1: los numeros de serie no pueden repetirse.");
  });

  it("rejects an expired date and a location that is not the operational one", () => {
    const canonical = receivingLine({
      tracking: { stock: true, lot: false, expiration: true, serial: false },
    });
    const line = {
      ...canonical,
      expirationDate: "2026-06-14",
      locationId: "location-other",
    };

    const errors = validateLines([line], [], asDetail(legacyDetail([canonical])), OPERATION_DATE);

    expect(errors).toContain(`Producto 1: ${EXPIRATION_BEFORE_ENTRY_MESSAGE}`);
    expect(errors).toContain("Producto 1: la ubicacion no coincide con la operativa de la linea.");
  });

  it("does not send a physical location when multiple locations are disabled", () => {
    const line = receivingLine();

    expect(
      validateLines([line], [], asDetail(legacyDetail([line], false)), OPERATION_DATE),
    ).toContain("Producto 1: la recepcion no debe enviar una ubicacion fisica.");
  });
});

describe("incident and quantity helpers", () => {
  it("counts editable and open incidents but not resolved ones nor other products", () => {
    const line = receivingLine();
    const incidents = [
      documentIncident({ id: "a", editable: true, quantityAffected: 1 }),
      documentIncident({ id: "b", editable: false, status: "open", quantityAffected: 2 }),
      documentIncident({ id: "c", editable: false, status: "resolved", quantityAffected: 4 }),
      documentIncident({ id: "d", editable: true, productId: "other", quantityAffected: 8 }),
      documentIncident({ id: "e", editable: true, quantityAffected: undefined }),
    ];

    expect(getRejectedNow(line, incidents)).toBe(3);
  });

  it("computes the remaining incident capacity without going below zero", () => {
    const line = receivingLine({ orderedQuantity: 10, acceptedPreviously: 2, receivedNow: 3 });
    const open = documentIncident({ editable: false, status: "open", quantityAffected: 1 });
    const resolved = documentIncident({
      id: "r",
      editable: false,
      status: "resolved",
      quantityAffected: 5,
    });

    expect(getIncidentCapacity(line, [open, resolved])).toBe(4);
    expect(getIncidentCapacity({ ...line, receivedNow: 20 }, [])).toBe(0);
  });

  it("rounds floating point noise when computing the capacity", () => {
    const line = receivingLine({
      unitAllowsDecimals: true,
      orderedQuantity: 0.3,
      acceptedPreviously: 0.1,
      receivedNow: 0.2,
    });

    expect(getIncidentCapacity(line, [])).toBe(0);
    expect(getIncidentCapacity({ ...line, orderedQuantity: 1 }, [])).toBe(0.7);
  });

  it("treats non numeric and negative received values as zero accepted", () => {
    expect(getAcceptedNow(receivingLine({ receivedNow: "" }))).toBe(0);
    expect(getAcceptedNow(receivingLine({ receivedNow: "2." }))).toBe(0);
    expect(getAcceptedNow(receivingLine({ receivedNow: -3 }))).toBe(0);
    expect(getAcceptedNow(receivingLine({ receivedNow: 4 }))).toBe(4);
  });

  it("converts to base units and parses serial numbers from lines or commas", () => {
    expect(toBaseQuantity({ purchaseToBaseFactor: 12 }, 2)).toBe(24);
    expect(parseSerialNumbers("S-1, S-2\r\nS-3\n\n  S-4  ,")).toEqual([
      "S-1",
      "S-2",
      "S-3",
      "S-4",
    ]);
  });

  it("detects an incomplete receipt history and the read only states of an order", () => {
    expect(isReceiptHistoryIncomplete(1, 2)).toBe(true);
    expect(isReceiptHistoryIncomplete(2, 2)).toBe(false);
    expect(isReceiptHistoryIncomplete(1, 0)).toBe(false);

    for (const status of [
      PurchaseOrderStatus.approved,
      PurchaseOrderStatus.sent,
      PurchaseOrderStatus.partially_received,
    ]) {
      expect(isApiReceivingReadOnly(status, false, false)).toBe(false);
      expect(isApiReceivingReadOnly(status, false, true)).toBe(true);
    }
    for (const status of [
      PurchaseOrderStatus.draft,
      PurchaseOrderStatus.pending_approval,
      PurchaseOrderStatus.received,
      PurchaseOrderStatus.cancelled,
    ]) {
      expect(isApiReceivingReadOnly(status, false, false)).toBe(true);
    }
  });
});

describe("draft persistence guards", () => {
  const draftInput = { tenantId: TENANT_ID, items: [] };

  function createReceipts() {
    return {
      getPageScoped: vi.fn<ReceiptRepository["getPageScoped"]>(),
      getRecordByIdScoped: vi.fn<ReceiptRepository["getRecordByIdScoped"]>(),
      createDraftScoped: vi.fn<ReceiptRepository["createDraftScoped"]>(),
      updateDraftScoped: vi.fn<ReceiptRepository["updateDraftScoped"]>(),
    };
  }

  /** Responde el borrador y el historial confirmado segun el `status` que pide la guarda. */
  function programPages(
    receipts: ReturnType<typeof createReceipts>,
    pages: {
      draft: PaginatedResult<ReceiptRecord>;
      confirmed?: PaginatedResult<ReceiptRecord>;
    },
  ) {
    receipts.getPageScoped.mockImplementation(async (_tenantId, params) =>
      params.status === "draft" ? pages.draft : (pages.confirmed ?? paginated([])),
    );
  }

  it("creates a draft when the order has none and the history is complete", async () => {
    const receipts = createReceipts();
    programPages(receipts, { draft: paginated([]) });
    receipts.createDraftScoped.mockResolvedValue(receiptRecord({ id: "new-draft" }));

    const record = await persistApiDraftWithHistoryGuard(
      receipts,
      TENANT_ID,
      BRANCH_ID,
      ORDER_ID,
      draftInput,
    );

    expect(record.receipt.id).toBe("new-draft");
    expect(receipts.createDraftScoped).toHaveBeenCalledWith({
      ...draftInput,
      purchaseOrderId: ORDER_ID,
    });
    expect(receipts.updateDraftScoped).not.toHaveBeenCalled();
  });

  it("updates the existing canonical draft instead of creating another", async () => {
    const receipts = createReceipts();
    const existing = receiptRecord();
    programPages(receipts, { draft: paginated([existing]) });
    receipts.getRecordByIdScoped.mockResolvedValue(existing);
    receipts.updateDraftScoped.mockResolvedValue(existing);

    await persistApiDraftWithHistoryGuard(receipts, TENANT_ID, BRANCH_ID, ORDER_ID, draftInput);

    expect(receipts.updateDraftScoped).toHaveBeenCalledWith(RECEIPT_ID, draftInput);
    expect(receipts.createDraftScoped).not.toHaveBeenCalled();
  });

  it("refuses to edit when the confirmed receipt history is incomplete", async () => {
    const receipts = createReceipts();
    programPages(receipts, {
      draft: paginated([]),
      confirmed: paginated([], { page: 1, totalPages: 3 }),
    });

    await expect(
      persistApiDraftWithHistoryGuard(receipts, TENANT_ID, BRANCH_ID, ORDER_ID, draftInput),
    ).rejects.toThrow("historial de recepciones anteriores está incompleto");
    expect(receipts.createDraftScoped).not.toHaveBeenCalled();
    expect(receipts.updateDraftScoped).not.toHaveBeenCalled();
  });

  it("refuses to edit when the order has more than one draft", async () => {
    const receipts = createReceipts();
    programPages(receipts, {
      draft: paginated([receiptRecord(), receiptRecord({ id: "receipt-2" })]),
    });

    await expect(
      persistApiDraftWithHistoryGuard(receipts, TENANT_ID, BRANCH_ID, ORDER_ID, draftInput),
    ).rejects.toThrow("varios borradores de recepción");
    expect(receipts.updateDraftScoped).not.toHaveBeenCalled();
  });

  it("queries drafts and confirmed receipts scoped to the order and branch", async () => {
    const receipts = createReceipts();
    programPages(receipts, { draft: paginated([]) });
    receipts.createDraftScoped.mockResolvedValue(receiptRecord());

    await persistApiDraftWithHistoryGuard(receipts, TENANT_ID, BRANCH_ID, ORDER_ID, draftInput);

    expect(receipts.getPageScoped).toHaveBeenCalledWith(TENANT_ID, {
      branchId: BRANCH_ID,
      purchaseOrderId: ORDER_ID,
      status: "draft",
      page: 1,
      pageSize: 2,
    });
    expect(receipts.getPageScoped).toHaveBeenCalledWith(TENANT_ID, {
      branchId: BRANCH_ID,
      purchaseOrderId: ORDER_ID,
      status: "confirmed",
      page: 1,
      pageSize: 100,
    });
  });

  it.each([
    ["is missing", null],
    ["belongs to another order", receiptRecord({ purchaseOrderId: "other-order" })],
    ["is no longer in progress", receiptRecord({ status: ReceiptStatus.received })],
  ])("does not update a canonical draft that %s", async (_label, record) => {
    const receipts = createReceipts();
    receipts.getRecordByIdScoped.mockResolvedValue(record);

    await expect(
      updateCanonicalDraft(receipts, TENANT_ID, ORDER_ID, RECEIPT_ID, draftInput),
    ).rejects.toThrow("No se encontró el borrador de recepción solicitado.");
    expect(receipts.updateDraftScoped).not.toHaveBeenCalled();
  });
});
