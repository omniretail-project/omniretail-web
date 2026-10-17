import { describe, expect, it, vi } from "vitest";
import type { PurchaseOrder } from "@/core/entities";
import type {
  ConfirmReceivingInput,
  ReceivingCapabilityFlags,
  ReceivingDocumentLine,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import {
  hasStaleLocationToPersist,
  ReceivingDocumentDetailService,
  STALE_LOCATION_LOCKED_DRAFT_MESSAGE,
} from "@/modules/receiving/application/services/ReceivingDocumentDetailService";

const CURRENT_LOCATION = "location-current";
const SAVED_LOCATION = "location-saved";

function line(overrides: Partial<ReceivingDocumentLine> = {}): ReceivingDocumentLine {
  return {
    id: "line-1",
    sourceLineId: "line-1",
    productId: "product-1",
    productName: "Producto 1",
    sku: "SKU-1",
    unitId: "unit-1",
    unitName: "Caja",
    unitAllowsDecimals: false,
    baseUnitId: "unit-1",
    baseUnitName: "Caja",
    baseUnitAllowsDecimals: false,
    orderedQuantity: 10,
    acceptedPreviously: 0,
    receivedNow: 2,
    pendingQuantity: 8,
    locationId: CURRENT_LOCATION,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    lotNumber: "",
    expirationDate: "",
    serialNumbersText: "",
    trackingDetails: [],
    notes: "",
    purchaseToBaseFactor: 1,
    ...overrides,
  };
}

function capabilities(supportsMultipleLocations: boolean): ReceivingCapabilityFlags {
  return {
    supportsInventory: true,
    supportsLots: true,
    supportsExpiration: true,
    supportsSerials: true,
    supportsMultipleLocations,
    supportsUnitsAndPackaging: true,
  };
}

const order = { id: "order-1", tenantId: "tenant-1", branchId: "branch-1" } as PurchaseOrder;

function confirmInput(
  lines: ReceivingDocumentLine[],
  hasUnsavedChanges = false,
): ConfirmReceivingInput {
  return {
    documentType: "purchase_order",
    documentId: order.id,
    lines,
    incidents: [],
    confirmationId: "confirmation-1",
    hasUnsavedChanges,
  };
}

function createFixture(detail: {
  lines: ReceivingDocumentLine[];
  capabilities: ReceivingCapabilityFlags;
  draftEditingLocked?: boolean;
  receiptId?: string;
}) {
  const calls: string[] = [];
  const repositories = {
    receipts: {
      listIncidentsScoped: vi.fn(async () => ({
        items: [],
        page: 1,
        pageSize: 100,
        totalItems: 0,
        totalPages: 1,
      })),
      confirmDraftScoped: vi.fn(async () => {
        calls.push("confirm");
        return { receipt: { id: "receipt-1" } };
      }),
    },
  };
  const service = new ReceivingDocumentDetailService(repositories as never);
  const internals = service as unknown as {
    getApiPurchaseOrderDocument: (order: PurchaseOrder) => Promise<unknown>;
    saveApiDraft: (order: PurchaseOrder, input: ConfirmReceivingInput) => Promise<unknown>;
    requireApiDraftRecord: () => Promise<unknown>;
    confirmApiReceipt: (order: PurchaseOrder, input: ConfirmReceivingInput) => Promise<unknown>;
  };
  vi.spyOn(internals, "getApiPurchaseOrderDocument").mockResolvedValue({
    readOnly: false,
    lines: detail.lines,
    capabilities: detail.capabilities,
    draftEditingLocked: detail.draftEditingLocked,
    document: { receiptId: detail.receiptId === undefined ? "receipt-1" : detail.receiptId },
  });
  const save = vi.spyOn(internals, "saveApiDraft").mockImplementation(async () => {
    calls.push("save");
    return { id: "receipt-1" };
  });
  vi.spyOn(internals, "requireApiDraftRecord").mockResolvedValue({
    receipt: { id: "receipt-1" },
  });
  return {
    calls,
    save,
    confirmDraftScoped: repositories.receipts.confirmDraftScoped,
    confirm: (input: ConfirmReceivingInput) => internals.confirmApiReceipt(order, input),
  };
}

describe("hasStaleLocationToPersist", () => {
  const detail = (lines: ReceivingDocumentLine[], multiple = true) => ({
    lines,
    capabilities: capabilities(multiple),
  });

  it("detects a saved location that differs from the current one for a received line", () => {
    const canonical = line({ staleSavedLocationId: SAVED_LOCATION });
    expect(hasStaleLocationToPersist(detail([canonical]), [line()])).toBe(true);
  });

  it("ignores lines without a stale location or without a positive received quantity", () => {
    expect(hasStaleLocationToPersist(detail([line()]), [line()])).toBe(false);
    expect(
      hasStaleLocationToPersist(detail([line({ staleSavedLocationId: SAVED_LOCATION })]), [
        line({ receivedNow: 0 }),
      ]),
    ).toBe(false);
    expect(
      hasStaleLocationToPersist(detail([line({ staleSavedLocationId: SAVED_LOCATION })]), [
        line({ receivedNow: "" }),
      ]),
    ).toBe(false);
  });

  it("does not apply with multiple locations OFF, without an assignment or without stock control", () => {
    const stale = { staleSavedLocationId: SAVED_LOCATION };
    expect(hasStaleLocationToPersist(detail([line(stale)], false), [line()])).toBe(false);
    expect(hasStaleLocationToPersist(detail([line({ ...stale, locationId: "" })]), [line()])).toBe(
      false,
    );
    expect(
      hasStaleLocationToPersist(
        detail([
          line({
            ...stale,
            tracking: { stock: false, lot: false, expiration: false, serial: false },
          }),
        ]),
        [line()],
      ),
    ).toBe(false);
  });
});

describe("confirmApiReceipt with a stale saved location", () => {
  it("saves the current location before confirming when the form has no pending changes", async () => {
    const stale = line({ staleSavedLocationId: SAVED_LOCATION });
    const fixture = createFixture({ lines: [stale], capabilities: capabilities(true) });

    await fixture.confirm(confirmInput([line()], false));

    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.calls).toEqual(["save", "confirm"]);
    // Se guarda lo que se muestra: la ubicacion operativa actual, no la obsoleta.
    const savedInput = fixture.save.mock.calls[0][1] as ConfirmReceivingInput;
    expect(savedInput.lines[0].locationId).toBe(CURRENT_LOCATION);
  });

  it("does not add a save when there are no pending changes and no stale location", async () => {
    const fixture = createFixture({ lines: [line()], capabilities: capabilities(true) });

    await fixture.confirm(confirmInput([line()], false));

    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(["confirm"]);
  });

  it("does not save twice when the user already has pending changes", async () => {
    const stale = line({ staleSavedLocationId: SAVED_LOCATION });
    const fixture = createFixture({ lines: [stale], capabilities: capabilities(true) });

    await fixture.confirm(confirmInput([line()], true));

    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.calls).toEqual(["save", "confirm"]);
  });

  it("never tries to save a draft locked by incidents and explains why", async () => {
    const stale = line({ staleSavedLocationId: SAVED_LOCATION });
    const fixture = createFixture({
      lines: [stale],
      capabilities: capabilities(true),
      draftEditingLocked: true,
    });

    await expect(fixture.confirm(confirmInput([line()], false))).rejects.toThrow(
      STALE_LOCATION_LOCKED_DRAFT_MESSAGE,
    );
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.confirmDraftScoped).not.toHaveBeenCalled();
  });

  it("confirms a locked draft without stale locations using its canonical saved state", async () => {
    const fixture = createFixture({
      lines: [line()],
      capabilities: capabilities(true),
      draftEditingLocked: true,
    });

    await fixture.confirm(confirmInput([line()], false));

    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(["confirm"]);
  });

  it("does not force a save for a stale line with zero received quantity", async () => {
    const stale = line({ staleSavedLocationId: SAVED_LOCATION });
    const other = line({ id: "line-2", sourceLineId: "line-2", productId: "product-2" });
    const fixture = createFixture({ lines: [stale, other], capabilities: capabilities(true) });

    await fixture.confirm(confirmInput([line({ receivedNow: 0 }), other], false));

    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(["confirm"]);
  });

  it("keeps blocking stock lines when multiple locations are OFF instead of saving", async () => {
    const stale = line({ locationId: "", staleSavedLocationId: SAVED_LOCATION });
    const fixture = createFixture({ lines: [stale], capabilities: capabilities(false) });

    await expect(
      fixture.confirm(confirmInput([line({ locationId: "" })], false)),
    ).rejects.toThrow();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.confirmDraftScoped).not.toHaveBeenCalled();
  });

  it("asks to configure the assignment for a legacy product without operational location", async () => {
    const legacy = line({ locationId: "", staleSavedLocationId: SAVED_LOCATION });
    const fixture = createFixture({ lines: [legacy], capabilities: capabilities(true) });

    await expect(fixture.confirm(confirmInput([line({ locationId: "" })], false))).rejects.toThrow(
      "configura una ubicación operativa activa",
    );
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("does not hide a real conflict returned when confirming after saving", async () => {
    const stale = line({ staleSavedLocationId: SAVED_LOCATION });
    const fixture = createFixture({ lines: [stale], capabilities: capabilities(true) });
    const conflict = Object.assign(new Error("INVENTORY_LOCATION_CONFLICT"), {
      code: "GOODS_RECEIPT_LOCATION_INVALID",
    });
    fixture.confirmDraftScoped.mockRejectedValueOnce(conflict);

    await expect(fixture.confirm(confirmInput([line()], false))).rejects.toBe(conflict);
    expect(fixture.save).toHaveBeenCalledTimes(1);
  });
});
