import { describe, expect, it, vi } from "vitest";
import { ReceiptLineStatus, ReceiptStatus } from "@/core/enums";
import type {
  ConfirmReceivingInput,
  SaveReceivingProgressInput,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import {
  apiIncident,
  capabilityFlags,
  createReceivingHarness,
  documentIncident,
  draftReceipt,
  OPERATIONAL_LOCATION_ID,
  ORDER_ID,
  paginated,
  receiptLineRecord,
  receiptRecord,
  receivingLine,
  RECEIPT_ID,
  TENANT_ID,
  USER_ID,
  BRANCH_ID,
} from "./receivingFixtures";

type Harness = ReturnType<typeof createReceivingHarness>;

/** Documento canonico que el servicio relee antes de validar, guardar o confirmar. */
function apiDetail(overrides: Record<string, unknown> = {}) {
  return {
    readOnly: false,
    lines: [receivingLine()],
    capabilities: capabilityFlags(),
    draftEditingLocked: false,
    incidents: [],
    incidentTypes: [],
    receiptHistoryIncomplete: false,
    document: { receiptId: RECEIPT_ID as string | undefined },
    ...overrides,
  };
}

function progressInput(overrides: Partial<SaveReceivingProgressInput> = {}) {
  return {
    documentType: "purchase_order",
    documentId: ORDER_ID,
    lines: [receivingLine()],
    incidents: [],
    ...overrides,
  } satisfies SaveReceivingProgressInput;
}

function confirmInput(overrides: Partial<ConfirmReceivingInput> = {}) {
  return {
    ...progressInput(),
    confirmationId: "confirmation-1",
    hasUnsavedChanges: false,
    ...overrides,
  } satisfies ConfirmReceivingInput;
}

function withApiDocument(harness: Harness, overrides: Record<string, unknown> = {}) {
  vi.spyOn(harness.internals, "getApiPurchaseOrderDocument").mockResolvedValue(
    apiDetail(overrides),
  );
  vi.spyOn(harness.internals, "getPurchaseOrderDocument").mockResolvedValue(apiDetail(overrides));
}

describe("saveProgress (API)", () => {
  it("requires permission to register receiving progress", async () => {
    const harness = createReceivingHarness({ permissions: ["receiving.receipts.read"] });
    withApiDocument(harness);

    await expect(harness.service.saveProgress(progressInput())).rejects.toThrow(
      "No dispone de permisos para registrar avances de recepción.",
    );
    expect(harness.receipts.createDraftScoped).not.toHaveBeenCalled();
  });

  it("stops at the first validation error before touching the backend", async () => {
    const harness = createReceivingHarness();
    withApiDocument(harness);

    await expect(
      harness.service.saveProgress(
        progressInput({ lines: [receivingLine({ receivedNow: 11 })] }),
      ),
    ).rejects.toThrow("Producto 1: la cantidad recibida no puede superar 10.");
    expect(harness.receipts.getPageScoped).not.toHaveBeenCalled();
    expect(harness.receipts.createDraftScoped).not.toHaveBeenCalled();
  });

  it("does not replace the products of a draft locked by incidents", async () => {
    const harness = createReceivingHarness();
    withApiDocument(harness, { draftEditingLocked: true });

    await expect(harness.service.saveProgress(progressInput())).rejects.toThrow(
      "No es seguro reemplazar los productos del borrador",
    );
    expect(harness.receipts.createDraftScoped).not.toHaveBeenCalled();
    expect(harness.receipts.updateDraftScoped).not.toHaveBeenCalled();
  });

  it("creates the first draft with the received lines and the operational location", async () => {
    const harness = createReceivingHarness();
    const untouched = receivingLine({
      id: "line-2",
      sourceLineId: "line-2",
      productId: "product-2",
      receivedNow: "",
    });
    withApiDocument(harness, { lines: [receivingLine(), untouched] });
    harness.receipts.createDraftScoped.mockResolvedValue(receiptRecord({ id: "receipt-new" }));

    const receipt = await harness.service.saveProgress(
      progressInput({ lines: [receivingLine({ receivedNow: 3 }), untouched] }),
    );

    expect(receipt.id).toBe("receipt-new");
    expect(harness.receipts.createDraftScoped).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      purchaseOrderId: ORDER_ID,
      items: [
        {
          purchaseOrderItemId: "line-1",
          receivedQuantity: 3,
          locationId: OPERATIONAL_LOCATION_ID,
          trackingDetails: [],
        },
      ],
    });
  });

  it("updates the existing draft of the order instead of creating another one", async () => {
    const harness = createReceivingHarness();
    withApiDocument(harness);
    const existing = receiptRecord();
    harness.receipts.getPageScoped.mockImplementation(async (_tenantId, params) =>
      paginated(params.status === "draft" ? [existing] : []),
    );
    harness.receipts.getRecordByIdScoped.mockResolvedValue(existing);
    harness.receipts.updateDraftScoped.mockResolvedValue(existing);

    await harness.service.saveProgress(progressInput());

    expect(harness.receipts.updateDraftScoped).toHaveBeenCalledTimes(1);
    expect(harness.receipts.updateDraftScoped.mock.calls[0][0]).toBe(RECEIPT_ID);
    expect(harness.receipts.createDraftScoped).not.toHaveBeenCalled();
  });

  it("sends lot and serial details trimmed and parsed for tracked products", async () => {
    const harness = createReceivingHarness();
    const tracked = receivingLine({
      tracking: { stock: true, lot: true, expiration: true, serial: true },
      receivedNow: 2,
      trackingDetails: [
        {
          id: "tracking-1",
          baseQuantity: 2,
          lotNumber: " L-1 ",
          expirationDate: "2999-01-01",
          serialNumbersText: "S-1\nS-2",
        },
      ],
    });
    withApiDocument(harness, { lines: [tracked] });

    await harness.service.saveProgress(progressInput({ lines: [tracked] }));

    expect(harness.receipts.createDraftScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            trackingDetails: [
              {
                baseQuantity: 2,
                lotNumber: "L-1",
                expirationDate: "2999-01-01",
                serialNumbers: ["S-1", "S-2"],
              },
            ],
          }),
        ],
      }),
    );
  });
});

describe("saveProgress (mock)", () => {
  const mockDetail = () =>
    apiDetail({ incidentTypes: [{ id: "damaged", name: "Dañado" }] });

  it("rejects an invalid incident before creating a receipt", async () => {
    const harness = createReceivingHarness({ dataSource: "mock" });
    vi.spyOn(harness.internals, "getPurchaseOrderDocument").mockResolvedValue(mockDetail());

    await expect(
      harness.service.saveProgress(
        progressInput({ incidents: [documentIncident({ description: "" })] }),
      ),
    ).rejects.toThrow("Producto 1: agrega la observacion de la incidencia.");
    expect(harness.receipts.create).not.toHaveBeenCalled();
    expect(harness.receipts.replaceLines).not.toHaveBeenCalled();
  });

  it("persists lines and incidents in an in-progress receipt keeping real authorship", async () => {
    const harness = createReceivingHarness({ dataSource: "mock" });
    vi.spyOn(harness.internals, "getPurchaseOrderDocument").mockResolvedValue(mockDetail());
    harness.receipts.replaceLines.mockResolvedValue([
      receiptLineRecord({ id: "receipt-line-1", receiptId: "receipt-created" }),
    ]);
    const fresh = documentIncident({ id: "draft-incident-1", createdByUserId: "ui-placeholder" });
    const persisted = documentIncident({
      id: "incident-9",
      createdByUserId: "user-9",
      description: "Empaque abierto",
    });

    const receipt = await harness.service.saveProgress(
      progressInput({ incidents: [fresh, persisted] }),
    );

    expect(harness.receipts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "REC-001",
        purchaseOrderId: ORDER_ID,
        status: ReceiptStatus.in_progress,
        receivedByUserId: USER_ID,
      }),
    );
    expect(harness.receipts.replaceLines).toHaveBeenCalledWith("receipt-created", [
      expect.objectContaining({
        productId: "product-1",
        receivedQuantity: 2,
        locationId: OPERATIONAL_LOCATION_ID,
      }),
    ]);
    const [, incidents] = harness.receipts.replaceIncidents.mock.calls[0];
    expect(incidents[0]).not.toHaveProperty("id");
    expect(incidents[0]).toMatchObject({
      receiptLineId: "receipt-line-1",
      createdByUserId: USER_ID,
    });
    expect(incidents[1]).toMatchObject({ id: "incident-9", createdByUserId: "user-9" });
    expect(harness.receipts.update).toHaveBeenCalledWith("receipt-created", {
      status: ReceiptStatus.in_progress,
    });
    expect(receipt.status).toBe(ReceiptStatus.in_progress);
  });

  it("reuses the in-progress receipt of the order", async () => {
    const harness = createReceivingHarness({ dataSource: "mock" });
    vi.spyOn(harness.internals, "getPurchaseOrderDocument").mockResolvedValue(mockDetail());
    harness.receipts.listByTenant.mockResolvedValue([draftReceipt({ id: "existing" })]);

    await harness.service.saveProgress(progressInput());

    expect(harness.receipts.create).not.toHaveBeenCalled();
    expect(harness.receipts.replaceLines).toHaveBeenCalledWith("existing", expect.any(Array));
  });
});

describe("deleteDraft", () => {
  it("requires permission to register receiving progress", async () => {
    const harness = createReceivingHarness({ permissions: ["receiving.receipts.read"] });

    await expect(harness.service.deleteDraft(RECEIPT_ID)).rejects.toThrow(
      "No dispone de permisos para registrar avances de recepción.",
    );
    expect(harness.receipts.deleteDraftScoped).not.toHaveBeenCalled();
  });

  it.each([
    ["does not exist", null],
    ["is already confirmed", receiptRecord({ status: ReceiptStatus.received })],
  ])("does not delete a draft that %s", async (_label, record) => {
    const harness = createReceivingHarness();
    harness.receipts.getRecordByIdScoped.mockResolvedValue(record);

    await expect(harness.service.deleteDraft(RECEIPT_ID)).rejects.toThrow(
      "No se encontró el borrador de recepción solicitado.",
    );
    expect(harness.receipts.deleteDraftScoped).not.toHaveBeenCalled();
  });

  it("keeps a draft that already has incidents because the backend retains its history", async () => {
    const harness = createReceivingHarness();
    harness.receipts.getRecordByIdScoped.mockResolvedValue(receiptRecord());
    harness.receipts.listIncidentsScoped.mockResolvedValue(paginated([apiIncident()]));

    await expect(harness.service.deleteDraft(RECEIPT_ID)).rejects.toThrow(
      "No se puede eliminar un borrador con incidencias",
    );
    expect(harness.receipts.deleteDraftScoped).not.toHaveBeenCalled();
  });

  it("deletes an in-progress draft without incidents inside the tenant scope", async () => {
    const harness = createReceivingHarness();
    harness.receipts.getRecordByIdScoped.mockResolvedValue(receiptRecord());

    await harness.service.deleteDraft(RECEIPT_ID);

    expect(harness.receipts.listIncidentsScoped).toHaveBeenCalledWith(TENANT_ID, RECEIPT_ID, {
      page: 1,
      pageSize: 1,
    });
    expect(harness.receipts.deleteDraftScoped).toHaveBeenCalledWith(TENANT_ID, RECEIPT_ID);
  });

  it("deletes mock drafts directly without the API incident precheck", async () => {
    const harness = createReceivingHarness({ dataSource: "mock" });

    await harness.service.deleteDraft(RECEIPT_ID);

    expect(harness.receipts.getRecordByIdScoped).not.toHaveBeenCalled();
    expect(harness.receipts.deleteDraftScoped).toHaveBeenCalledWith(TENANT_ID, RECEIPT_ID);
  });
});

describe("createIncident", () => {
  const generalInput = {
    documentId: ORDER_ID,
    receiptId: RECEIPT_ID,
    incidentType: "damaged" as const,
    notes: "  Caja golpeada  ",
  };
  const itemRecord = (unitId = "unit-1") =>
    receiptRecord({}, [
      { line: receiptLineRecord({ id: "gri-1" }), unitId, trackingDetails: [] },
    ]);

  function setup(options: Parameters<typeof createReceivingHarness>[0] = {}, history = false) {
    const harness = createReceivingHarness(options);
    harness.receipts.getRecordByIdScoped.mockResolvedValue(itemRecord());
    vi.spyOn(harness.internals, "getApiPurchaseOrderDocument").mockResolvedValue(
      apiDetail({
        lines: [receivingLine({ goodsReceiptItemId: "gri-1" })],
        receiptHistoryIncomplete: history,
      }),
    );
    return harness;
  }

  it("requires permission to manage incidents", async () => {
    const harness = setup({ permissions: ["receiving.receipts.confirm"] });

    await expect(harness.service.createIncident(generalInput)).rejects.toThrow(
      "No dispone de permisos para gestionar incidencias.",
    );
  });

  it("is only available for the receipts API", async () => {
    const harness = setup({ dataSource: "mock" });

    await expect(harness.service.createIncident(generalInput)).rejects.toThrow(
      "Esta operación corresponde únicamente a Receipt API.",
    );
    expect(harness.receipts.createIncidentScoped).not.toHaveBeenCalled();
  });

  it("rejects a draft that belongs to another branch than the order", async () => {
    const harness = setup();
    harness.receipts.getRecordByIdScoped.mockResolvedValue(
      receiptRecord({ branchId: "other-branch" }),
    );

    await expect(harness.service.createIncident(generalInput)).rejects.toThrow(
      "El borrador no pertenece a la sucursal de la orden.",
    );
  });

  it("requires trimmed notes within the backend limit", async () => {
    const harness = setup();

    await expect(
      harness.service.createIncident({ ...generalInput, notes: "   " }),
    ).rejects.toThrow("Agrega la observación de la incidencia.");
    await expect(
      harness.service.createIncident({ ...generalInput, notes: "x".repeat(1_001) }),
    ).rejects.toThrow("La observación admite hasta 1,000 caracteres.");
    expect(harness.receipts.createIncidentScoped).not.toHaveBeenCalled();
  });

  it("creates a general incident without an affected quantity", async () => {
    const harness = setup();

    await harness.service.createIncident(generalInput);

    expect(harness.receipts.createIncidentScoped).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      receiptId: RECEIPT_ID,
      incidentType: "damaged",
      notes: "Caja golpeada",
    });
  });

  it("does not accept an affected quantity on a general incident", async () => {
    const harness = setup();

    await expect(
      harness.service.createIncident({ ...generalInput, quantityAffected: 1 }),
    ).rejects.toThrow("Una incidencia general no debe incluir cantidad afectada.");
  });

  it("rejects a line that does not belong to the current draft", async () => {
    const harness = setup();

    await expect(
      harness.service.createIncident({
        ...generalInput,
        goodsReceiptItemId: "gri-other",
        quantityAffected: 1,
      }),
    ).rejects.toThrow("La línea recibida no pertenece al borrador actual.");
  });

  it.each([0, 9])(
    "limits the affected quantity to the open capacity of the line (%s)",
    async (quantityAffected) => {
      const harness = setup();

      await expect(
        harness.service.createIncident({
          ...generalInput,
          goodsReceiptItemId: "gri-1",
          quantityAffected,
        }),
      ).rejects.toThrow("La cantidad afectada debe estar entre 0 y 8.");
      expect(harness.receipts.createIncidentScoped).not.toHaveBeenCalled();
    },
  );

  it("only requires a positive quantity when the receipt history is incomplete", async () => {
    const harness = setup({}, true);

    await expect(
      harness.service.createIncident({
        ...generalInput,
        goodsReceiptItemId: "gri-1",
        quantityAffected: -1,
      }),
    ).rejects.toThrow("La cantidad afectada debe ser mayor a 0.");
    await harness.service.createIncident({
      ...generalInput,
      goodsReceiptItemId: "gri-1",
      quantityAffected: 50,
    });
    expect(harness.receipts.createIncidentScoped).toHaveBeenCalledTimes(1);
  });

  it("rejects fractions on whole units and more than three decimals on decimal units", async () => {
    const whole = setup();
    await expect(
      whole.service.createIncident({
        ...generalInput,
        goodsReceiptItemId: "gri-1",
        quantityAffected: 1.5,
      }),
    ).rejects.toThrow("La unidad recibida no admite cantidades fraccionarias.");

    const decimal = setup({ units: [{ id: "unit-1", allowsDecimals: true }] });
    await expect(
      decimal.service.createIncident({
        ...generalInput,
        goodsReceiptItemId: "gri-1",
        quantityAffected: 1.2345,
      }),
    ).rejects.toThrow("La cantidad afectada admite hasta 3 decimales.");
  });

  it("forwards the line and the affected quantity of a valid line incident", async () => {
    const harness = setup();

    await harness.service.createIncident({
      ...generalInput,
      incidentType: "missing",
      goodsReceiptItemId: "gri-1",
      quantityAffected: 3,
    });

    expect(harness.receipts.createIncidentScoped).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      receiptId: RECEIPT_ID,
      incidentType: "missing",
      goodsReceiptItemId: "gri-1",
      quantityAffected: 3,
      notes: "Caja golpeada",
    });
  });
});

describe("resolveIncident", () => {
  function setup(options: Parameters<typeof createReceivingHarness>[0] = {}) {
    const harness = createReceivingHarness(options);
    harness.receipts.getRecordByIdScoped.mockResolvedValue(receiptRecord());
    return harness;
  }

  it("is only available for the receipts API", async () => {
    const harness = setup({ dataSource: "mock" });

    await expect(
      harness.service.resolveIncident(ORDER_ID, RECEIPT_ID, "incident-1"),
    ).rejects.toThrow("Esta operación corresponde únicamente a Receipt API.");
  });

  it("rejects an incident that is not in the current draft", async () => {
    const harness = setup();
    harness.receipts.listIncidentsScoped.mockResolvedValue(paginated([apiIncident({ id: "x" })]));

    await expect(
      harness.service.resolveIncident(ORDER_ID, RECEIPT_ID, "incident-1"),
    ).rejects.toThrow("La incidencia no pertenece al borrador actual.");
  });

  it("does not resolve an incident twice", async () => {
    const harness = setup();
    harness.receipts.listIncidentsScoped.mockResolvedValue(
      paginated([apiIncident({ status: "resolved" })]),
    );

    await expect(
      harness.service.resolveIncident(ORDER_ID, RECEIPT_ID, "incident-1"),
    ).rejects.toThrow("La incidencia ya está resuelta.");
    expect(harness.receipts.resolveIncidentScoped).not.toHaveBeenCalled();
  });

  it("resolves an incident without quantity directly", async () => {
    const harness = setup();
    harness.receipts.listIncidentsScoped.mockResolvedValue(paginated([apiIncident()]));

    const result = await harness.service.resolveIncident(ORDER_ID, RECEIPT_ID, "incident-1");

    expect(harness.receipts.resolveIncidentScoped).toHaveBeenCalledWith(TENANT_ID, "incident-1");
    expect(harness.receipts.resolveIncidentWithReplacementScoped).not.toHaveBeenCalled();
    expect(result.status).toBe("resolved");
  });

  it("accepts the replacement of an incident with affected quantity", async () => {
    const harness = setup();
    harness.receipts.listIncidentsScoped.mockResolvedValue(
      paginated([apiIncident({ quantityAffected: 3 })]),
    );

    const result = await harness.service.resolveIncident(ORDER_ID, RECEIPT_ID, "incident-1");

    expect(harness.receipts.resolveIncidentWithReplacementScoped).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      receiptId: RECEIPT_ID,
      incidentId: "incident-1",
      replacementQuantity: 3,
    });
    expect(harness.receipts.resolveIncidentScoped).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: "incident-1", status: "resolved" });
  });

  it("forwards the tracking details of the replacement when they are provided", async () => {
    const harness = setup();
    harness.receipts.listIncidentsScoped.mockResolvedValue(
      paginated([apiIncident({ quantityAffected: 3 })]),
    );
    const trackingDetails = [{ baseQuantity: 3, lotNumber: "L-1", serialNumbers: [] }];

    await harness.service.resolveIncident(ORDER_ID, RECEIPT_ID, "incident-1", trackingDetails);

    expect(harness.receipts.resolveIncidentWithReplacementScoped).toHaveBeenCalledWith(
      expect.objectContaining({ trackingDetails }),
    );
  });
});

describe("confirm (API purchase orders)", () => {
  function setup(
    overrides: Record<string, unknown> = {},
    options: Parameters<typeof createReceivingHarness>[0] = {},
  ) {
    const harness = createReceivingHarness(options);
    withApiDocument(harness, overrides);
    harness.receipts.getRecordByIdScoped.mockImplementation(async (_tenantId, id) =>
      receiptRecord({ id }),
    );
    return harness;
  }

  it("requires permission to confirm receipts", async () => {
    const harness = setup({}, { permissions: ["receiving.receipts.create"] });

    await expect(harness.service.confirm(confirmInput())).rejects.toThrow(
      "No dispone de permisos para confirmar recepciones.",
    );
    expect(harness.receipts.confirmDraftScoped).not.toHaveBeenCalled();
  });

  it("does not confirm an order that is read only in its current state", async () => {
    const harness = setup({ readOnly: true });

    await expect(harness.service.confirm(confirmInput())).rejects.toThrow(
      "La recepción no puede confirmarse en su estado actual.",
    );
    expect(harness.receipts.confirmDraftScoped).not.toHaveBeenCalled();
  });

  it("surfaces the first validation error without saving", async () => {
    const harness = setup();

    await expect(
      harness.service.confirm(
        confirmInput({ lines: [receivingLine({ receivedNow: 11 })], hasUnsavedChanges: true }),
      ),
    ).rejects.toThrow("Producto 1: la cantidad recibida no puede superar 10.");
    expect(harness.receipts.createDraftScoped).not.toHaveBeenCalled();
  });

  it("does not replace a locked draft when the form has unsaved changes", async () => {
    const harness = setup({ draftEditingLocked: true });

    await expect(
      harness.service.confirm(confirmInput({ hasUnsavedChanges: true })),
    ).rejects.toThrow("Confirma usando el estado canónico guardado");
    expect(harness.receipts.createDraftScoped).not.toHaveBeenCalled();
    expect(harness.receipts.updateDraftScoped).not.toHaveBeenCalled();
    expect(harness.receipts.confirmDraftScoped).not.toHaveBeenCalled();
  });

  it("confirms a locked draft with its canonical saved state when nothing changed", async () => {
    const harness = setup({ draftEditingLocked: true });

    const receipt = await harness.service.confirm(confirmInput());

    expect(harness.receipts.createDraftScoped).not.toHaveBeenCalled();
    expect(harness.receipts.confirmDraftScoped).toHaveBeenCalledWith(TENANT_ID, RECEIPT_ID);
    expect(receipt.id).toBe(RECEIPT_ID);
  });

  it("confirms the saved draft directly when there are no pending changes", async () => {
    const harness = setup();
    harness.receipts.confirmDraftScoped.mockResolvedValue(
      receiptRecord({ status: ReceiptStatus.received }),
    );

    const receipt = await harness.service.confirm(confirmInput());

    expect(harness.receipts.createDraftScoped).not.toHaveBeenCalled();
    expect(harness.receipts.updateDraftScoped).not.toHaveBeenCalled();
    expect(receipt.status).toBe(ReceiptStatus.received);
  });

  it("saves pending changes before confirming and confirms the saved draft", async () => {
    const harness = setup();

    await harness.service.confirm(confirmInput({ hasUnsavedChanges: true }));

    expect(harness.receipts.createDraftScoped).toHaveBeenCalledTimes(1);
    expect(harness.receipts.createDraftScoped.mock.invocationCallOrder[0]).toBeLessThan(
      harness.receipts.confirmDraftScoped.mock.invocationCallOrder[0],
    );
  });

  it("creates the draft first when the order has no saved draft yet", async () => {
    const harness = setup({ document: { receiptId: undefined } });
    harness.receipts.createDraftScoped.mockResolvedValue(receiptRecord({ id: "receipt-new" }));

    await harness.service.confirm(confirmInput());

    expect(harness.receipts.createDraftScoped).toHaveBeenCalledTimes(1);
    expect(harness.receipts.confirmDraftScoped).toHaveBeenCalledWith(TENANT_ID, "receipt-new");
  });

  it("does not confirm while the draft has open incidents", async () => {
    const harness = setup();
    harness.receipts.listIncidentsScoped.mockResolvedValue(
      paginated([apiIncident({ status: "open" })]),
    );

    await expect(harness.service.confirm(confirmInput())).rejects.toThrow(
      "La recepción tiene incidencias abiertas que deben resolverse antes de confirmar.",
    );
    expect(harness.receipts.confirmDraftScoped).not.toHaveBeenCalled();
  });

  it("does not confirm when the incident list is incomplete", async () => {
    const harness = setup();
    harness.receipts.listIncidentsScoped.mockResolvedValue(
      paginated([apiIncident({ status: "resolved" })], { totalPages: 2, totalItems: 150 }),
    );

    await expect(harness.service.confirm(confirmInput())).rejects.toThrow(
      "la lista de incidencias está incompleta",
    );
    expect(harness.receipts.confirmDraftScoped).not.toHaveBeenCalled();
  });

  it("rejects a saved draft that is no longer in progress", async () => {
    const harness = setup();
    harness.receipts.getRecordByIdScoped.mockResolvedValue(
      receiptRecord({ status: ReceiptStatus.received }),
    );

    await expect(harness.service.confirm(confirmInput())).rejects.toThrow(
      "No se encontró el borrador de recepción solicitado.",
    );
    expect(harness.receipts.confirmDraftScoped).not.toHaveBeenCalled();
  });
});

describe("confirm (mock purchase orders)", () => {
  const mockDetail = (lines = [receivingLine()]) =>
    apiDetail({ lines, incidentTypes: [{ id: "damaged", name: "Dañado" }] });

  function setup(lines = [receivingLine()]) {
    const harness = createReceivingHarness({ dataSource: "mock" });
    vi.spyOn(harness.internals, "getPurchaseOrderDocument").mockResolvedValue(mockDetail(lines));
    return harness;
  }

  it("requires a confirmation identity", async () => {
    const harness = setup();

    await expect(
      harness.service.confirm(confirmInput({ confirmationId: "   " })),
    ).rejects.toThrow("La confirmacion de recepcion requiere una identidad.");
    expect(harness.receipts.confirmReceiptInventory).not.toHaveBeenCalled();
  });

  it("creates the in-progress receipt and confirms the inventory with base quantities", async () => {
    const harness = setup([receivingLine({ purchaseToBaseFactor: 12 })]);

    const receipt = await harness.service.confirm(
      confirmInput({
        lines: [receivingLine({ purchaseToBaseFactor: 12 })],
        incidents: [documentIncident({ quantityAffected: 1 })],
      }),
    );

    expect(harness.receipts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "REC-001",
        branchId: BRANCH_ID,
        status: ReceiptStatus.in_progress,
        receivedByUserId: USER_ID,
      }),
    );
    const input = harness.receipts.confirmReceiptInventory.mock.calls[0][0];
    expect(input).toMatchObject({
      receiptId: "receipt-created",
      tenantId: TENANT_ID,
      confirmationId: "confirmation-1",
      receivedByUserId: USER_ID,
      notes: "Recepcion confirmada con 1 unidades rechazadas.",
    });
    expect(input.lines[0]).toMatchObject({
      productId: "product-1",
      receivedQuantity: 2,
      inventoryQuantity: 24,
      rejectedQuantity: 1,
      status: ReceiptLineStatus.incident,
    });
    expect(input.incidents[0]).not.toHaveProperty("id");
    expect(input.incidents[0]).toMatchObject({ createdByUserId: USER_ID });
    expect(receipt).toBe(await harness.receipts.confirmReceiptInventory.mock.results[0].value);
  });

  it("reuses the in-progress receipt and numbers new receipts after the highest one", async () => {
    const reuse = setup();
    reuse.receipts.listByTenant.mockResolvedValue([draftReceipt({ id: "existing" })]);
    await reuse.service.confirm(confirmInput());
    expect(reuse.receipts.create).not.toHaveBeenCalled();
    expect(reuse.receipts.confirmReceiptInventory.mock.calls[0][0].receiptId).toBe("existing");

    const numbered = setup();
    numbered.receipts.listByTenant.mockResolvedValue([
      draftReceipt({
        id: "old",
        number: "REC-007",
        purchaseOrderId: "other-order",
        status: ReceiptStatus.received,
      }),
    ]);
    await numbered.service.confirm(confirmInput());
    expect(numbered.receipts.create).toHaveBeenCalledWith(
      expect.objectContaining({ number: "REC-008" }),
    );
  });

  it("rejects invalid lines before creating any receipt", async () => {
    const harness = setup();

    await expect(
      harness.service.confirm(confirmInput({ lines: [receivingLine({ receivedNow: 11 })] })),
    ).rejects.toThrow("Producto 1: aceptado ahora debe estar entre 0 y 10.");
    expect(harness.receipts.create).not.toHaveBeenCalled();
    expect(harness.receipts.confirmReceiptInventory).not.toHaveBeenCalled();
  });

  it("returns the previous confirmation when the same data is submitted again", async () => {
    const harness = setup();
    await harness.service.confirm(confirmInput());
    const sent = harness.receipts.confirmReceiptInventory.mock.calls[0][0];
    const previous = draftReceipt({
      status: ReceiptStatus.received,
      confirmationId: "confirmation-1",
      confirmationFingerprint: sent.confirmationFingerprint,
    });
    harness.receipts.getByConfirmationId.mockResolvedValue(previous);

    const replay = await harness.service.confirm(confirmInput());

    expect(replay).toBe(previous);
    expect(harness.receipts.confirmReceiptInventory).toHaveBeenCalledTimes(1);
  });

  it("rejects reusing a confirmation identity with different data", async () => {
    const harness = setup();
    harness.receipts.getByConfirmationId.mockResolvedValue(
      draftReceipt({
        confirmationId: "confirmation-1",
        confirmationFingerprint: "{}",
        status: ReceiptStatus.received,
      }),
    );

    await expect(harness.service.confirm(confirmInput())).rejects.toThrow(
      "La confirmacion confirmation-1 ya fue usada con datos distintos.",
    );
    expect(harness.receipts.confirmReceiptInventory).not.toHaveBeenCalled();
  });

  it("derives the same fingerprint regardless of the order of the lines", async () => {
    const first = receivingLine();
    const second = receivingLine({
      id: "line-2",
      sourceLineId: "line-2",
      productId: "product-2",
      productName: "Producto 2",
    });
    const harness = setup([first, second]);

    await harness.service.confirm(confirmInput({ lines: [first, second] }));
    await harness.service.confirm(confirmInput({ lines: [second, first] }));

    const [firstCall, secondCall] = harness.receipts.confirmReceiptInventory.mock.calls;
    expect(firstCall[0].confirmationFingerprint).toBe(secondCall[0].confirmationFingerprint);
  });

  it("derives another fingerprint when the accepted quantity changes", async () => {
    const harness = setup();

    await harness.service.confirm(confirmInput());
    await harness.service.confirm(
      confirmInput({ lines: [receivingLine({ receivedNow: 3 })] }),
    );

    const [firstCall, secondCall] = harness.receipts.confirmReceiptInventory.mock.calls;
    expect(firstCall[0].confirmationFingerprint).not.toBe(
      secondCall[0].confirmationFingerprint,
    );
  });
});
