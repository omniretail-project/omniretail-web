import { describe, expect, it, vi } from "vitest";
import {
  LocationStatus,
  PurchaseOrderStatus,
  ReceiptLineStatus,
  ReceiptStatus,
} from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { toCreateDraftRequest } from "@/infrastructure/api/repositories/ApiReceiptRepository";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockReceiptRepository } from "@/infrastructure/mock/repositories/MockReceiptRepository";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import type {
  ReceivingCapabilityFlags,
  ReceivingDocumentLine,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import {
  LOCATIONS_DISABLED_RECEIPT_BLOCK_MESSAGE,
  loadReceivingReadsInParallel,
  resolveReceivingLineLocation,
  validateApiDraftLines,
} from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import { toFriendlyReceivingError } from "@/modules/receiving/hooks/useReceivingDocumentDetail";

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const defaultLocationId = "10000000-0000-4000-8000-000000000003";
const savedLocationId = "10000000-0000-4000-8000-000000000004";
const purchaseOrderId = "10000000-0000-4000-8000-000000000005";
const firstItemId = "10000000-0000-4000-8000-000000000006";
const secondItemId = "10000000-0000-4000-8000-000000000007";

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

function location(id: string, status = LocationStatus.active) {
  return {
    id,
    tenantId,
    branchId,
    code: id === defaultLocationId ? "DEF" : "SAVED",
    name: id === defaultLocationId ? "Predeterminada" : "Guardada",
    type: "warehouse" as const,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("receiving operational location", () => {
  it("replaces a stale but still active saved draft location with the assigned one", () => {
    expect(
      resolveReceivingLineLocation({
        tenantId,
        branchId,
        savedLocationId,
        defaultLocationId,
        supportsMultipleLocations: true,
        locations: [location(defaultLocationId), location(savedLocationId)],
      }),
    ).toBe(defaultLocationId);
  });

  it("returns no location when the product has no active assignment, never the saved one", () => {
    expect(
      resolveReceivingLineLocation({
        tenantId,
        branchId,
        savedLocationId,
        defaultLocationId: undefined,
        supportsMultipleLocations: true,
        locations: [location(savedLocationId)],
      }),
    ).toBe("");
  });

  it("prefills the active default and rejects inactive historical choices", () => {
    expect(
      resolveReceivingLineLocation({
        tenantId,
        branchId,
        savedLocationId,
        defaultLocationId,
        supportsMultipleLocations: true,
        locations: [
          location(defaultLocationId),
          location(savedLocationId, LocationStatus.inactive),
        ],
      }),
    ).toBe(defaultLocationId);
  });

  it("returns no physical UUID when multiple locations are disabled", () => {
    expect(
      resolveReceivingLineLocation({
        tenantId,
        branchId,
        savedLocationId,
        defaultLocationId,
        supportsMultipleLocations: false,
        locations: [location(defaultLocationId), location(savedLocationId)],
      }),
    ).toBe("");
  });
});

describe("receiving load parallelism", () => {
  it("starts independent reads before capabilities resolves and only then decides locations", async () => {
    const calls: string[] = [];
    let resolveCapabilities!: (value: { supportsMultipleLocations: boolean }) => void;
    const capabilities = new Promise<{ supportsMultipleLocations: boolean }>((resolve) => {
      resolveCapabilities = resolve;
    });
    const loadLocations = vi.fn(async () => {
      calls.push("locations");
      return [location(defaultLocationId)];
    });

    const resultPromise = loadReceivingReadsInParallel({
      loadCapabilities: () => {
        calls.push("capabilities");
        return capabilities;
      },
      independentLoaders: [
        async () => {
          calls.push("branches");
          return "branches";
        },
        async () => {
          calls.push("drafts");
          return "drafts";
        },
      ] as const,
      loadLocations,
    });

    expect(calls).toEqual(["capabilities", "branches", "drafts"]);
    expect(loadLocations).not.toHaveBeenCalled();
    resolveCapabilities({ supportsMultipleLocations: true });
    await expect(resultPromise).resolves.toMatchObject({
      independent: ["branches", "drafts"],
      locations: [{ id: defaultLocationId }],
    });
    expect(calls).toEqual(["capabilities", "branches", "drafts", "locations"]);
  });
});

describe("ApiReceiptRepository location payload", () => {
  it("preserves different locations per item, tracking details and purchase-to-base quantities", () => {
    const request = toCreateDraftRequest({
      tenantId,
      purchaseOrderId,
      items: [
        {
          purchaseOrderItemId: firstItemId,
          receivedQuantity: 2,
          locationId: defaultLocationId,
          trackingDetails: [
            {
              baseQuantity: 12,
              lotNumber: "LOTE-1",
              expirationDate: "2027-01-01",
              serialNumbers: ["SER-1"],
            },
          ],
        },
        {
          purchaseOrderItemId: secondItemId,
          receivedQuantity: 1,
          locationId: savedLocationId,
          trackingDetails: [],
        },
      ],
    });

    expect(request.items.map((item) => item.locationId)).toEqual([
      defaultLocationId,
      savedLocationId,
    ]);
    expect(request.items[0].trackingDetails[0]).toMatchObject({
      baseQuantity: 12,
      lotNumber: "LOTE-1",
      expirationDate: "2027-01-01",
      serialNumbers: ["SER-1"],
    });
  });

  it("serializes an omitted location as explicit null", () => {
    const request = toCreateDraftRequest({
      tenantId,
      purchaseOrderId,
      items: [
        {
          purchaseOrderItemId: firstItemId,
          receivedQuantity: 1,
          trackingDetails: [],
        },
      ],
    });
    expect(request.items[0].locationId).toBeNull();
  });
});

describe("MockReceiptRepository operational location", () => {
  it("rejects a stock entry outside the product operational location", async () => {
    const store = new MockDatabaseStore(new MemoryStorageAdapter());
    const snapshot = store.getSnapshot();
    const settings = snapshot.productInventorySettings.find(
      (item) =>
        item.defaultLocationId &&
        snapshot.products.some(
          (product) => product.id === item.productId && product.productType === "physical",
        ),
    );
    if (!settings?.defaultLocationId) throw new Error("Fixture sin ubicacion operativa.");
    const product = snapshot.products.find((item) => item.id === settings.productId);
    const defaultLocation = snapshot.storageLocations.find(
      (item) => item.id === settings.defaultLocationId,
    );
    const orderTemplate = snapshot.purchaseOrders[0];
    const itemTemplate = snapshot.purchaseOrderItems[0];
    if (!product || !defaultLocation || !orderTemplate || !itemTemplate) {
      throw new Error("Fixture de recepcion incompleto.");
    }
    const orderId = "mock-order-operational-location";
    const receiptId = "mock-receipt-operational-location";
    const wrongLocationId = "mock-wrong-operational-location";
    store.mutate((database) => {
      const storedProduct = database.products.find((item) => item.id === product.id)!;
      storedProduct.tracking = { stock: true, lot: false, expiration: false, serial: false };
      const capabilities = database.businessCapabilities.find(
        (item) => item.tenantId === settings.tenantId,
      );
      if (capabilities) capabilities.supportsMultipleLocations = true;
      database.storageLocations.push({
        ...defaultLocation,
        id: wrongLocationId,
        status: LocationStatus.inactive,
      });
      database.purchaseOrders.push({
        ...orderTemplate,
        id: orderId,
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        number: "PO-LOCATION-TEST",
        status: PurchaseOrderStatus.sent,
        items: undefined,
      });
      database.purchaseOrderItems.push({
        ...itemTemplate,
        id: "mock-order-item-operational-location",
        purchaseOrderId: orderId,
        productId: settings.productId,
        quantity: 1,
        unitId: product.baseUnitId,
        purchaseToBaseFactor: 1,
      });
      database.receipts.push({
        id: receiptId,
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        number: "REC-LOCATION-TEST",
        purchaseOrderId: orderId,
        supplierId: orderTemplate.supplierId,
        status: ReceiptStatus.in_progress,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });
    const repository = new MockReceiptRepository(store, new DataEventBus());

    await expect(
      repository.confirmReceiptInventory({
        receiptId,
        tenantId: settings.tenantId,
        confirmationId: "confirmation-operational-location",
        confirmationFingerprint: "fingerprint-operational-location",
        receivedByUserId: "mock-user",
        receivedAt: "2026-01-02T00:00:00.000Z",
        lines: [
          {
            productId: settings.productId,
            orderedQuantity: 1,
            receivedQuantity: 1,
            inventoryQuantity: 1,
            status: ReceiptLineStatus.complete,
            locationId: wrongLocationId,
          },
        ],
        incidents: [],
      }),
    ).rejects.toThrow("active and match the receipt tenant and branch");
  });
});

function draftLine(overrides: Partial<ReceivingDocumentLine> = {}): ReceivingDocumentLine {
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
    pendingQuantity: 10,
    locationId: defaultLocationId,
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

describe("validateApiDraftLines location rules", () => {
  it("accepts different products received in their own assigned locations", () => {
    const first = draftLine();
    const second = draftLine({
      id: "line-2",
      sourceLineId: "line-2",
      productId: "product-2",
      locationId: savedLocationId,
    });

    expect(
      validateApiDraftLines([first, second], {
        lines: [first, second],
        capabilities: capabilities(true),
      }).filter((message) => /ubicaci/i.test(message)),
    ).toEqual([]);
  });

  it("rejects a line whose location differs from the assigned one instead of confirming it", () => {
    const canonical = draftLine();
    const stale = draftLine({ locationId: savedLocationId });

    expect(
      validateApiDraftLines([stale], { lines: [canonical], capabilities: capabilities(true) }),
    ).toContain("Producto 1: la ubicación no coincide con la operativa de la línea.");
  });

  it("asks to configure the assignment when the product has no operational location", () => {
    const unassigned = draftLine({ locationId: "" });

    expect(
      validateApiDraftLines([unassigned], {
        lines: [unassigned],
        capabilities: capabilities(true),
      }),
    ).toContain("Producto 1: configura una ubicación operativa activa.");
  });

  it("blocks stock lines when locations are disabled instead of sending null or a made-up UUID", () => {
    const line = draftLine({ locationId: "" });
    const errors = validateApiDraftLines([line], {
      lines: [line],
      capabilities: capabilities(false),
    });

    expect(errors).toContain(`Producto 1: ${LOCATIONS_DISABLED_RECEIPT_BLOCK_MESSAGE}`);
  });

  it("does not block lines of products that do not control stock", () => {
    const service = draftLine({
      locationId: "",
      tracking: { stock: false, lot: false, expiration: false, serial: false },
    });

    expect(
      validateApiDraftLines([service], {
        lines: [service],
        capabilities: capabilities(false),
      }).filter((message) => /ubicaci/i.test(message)),
    ).toEqual([]);
  });
});

describe("receiving 409 errors", () => {
  it("keeps the server detail (SKU and line) of GOODS_RECEIPT_LOCATION_INVALID", () => {
    const detail =
      "La recepción tiene líneas cuya ubicación no es la operativa del producto en la sucursal: " +
      "SKU-1 (línea 5d1b): La ubicación solicitada no es la ubicación asignada al producto en esta sucursal.";

    expect(
      toFriendlyReceivingError(
        new BackendRequestError(detail, 409, "GOODS_RECEIPT_LOCATION_INVALID"),
      ).message,
    ).toBe(detail);
  });

  it.each([
    ["INVENTORY_ASSIGNED_LOCATION_INACTIVE", "inactiva"],
    ["INVENTORY_LOCATION_NOT_ASSIGNED", "no tiene una ubicación operativa asignada"],
    ["INVENTORY_LOCATION_MISMATCH", "no es la ubicación operativa asignada"],
    ["INVENTORY_LOCATION_CONFLICT", "conserva existencias en otra ubicación"],
    ["INVENTORY_LOCATION_CHANGE_BLOCKED", "no puede cambiar"],
  ])("distinguishes the real backend code %s", (code, expected) => {
    expect(
      toFriendlyReceivingError(new BackendRequestError("server", 409, code)).message,
    ).toContain(expected);
  });

  it("maps incidents, preserves unknown messages and ignores look-alike codes", () => {
    expect(
      toFriendlyReceivingError(new BackendRequestError("open", 409, "RECEIPT_HAS_OPEN_INCIDENTS"))
        .message,
    ).toContain("incidencias abiertas");
    expect(
      toFriendlyReceivingError(
        new BackendRequestError("Mensaje original", 409, "SOMETHING_LOCATION_ELSE"),
      ).message,
    ).toBe("Mensaje original");
    expect(
      toFriendlyReceivingError(new BackendRequestError("Conflicto específico", 409, "OTHER"))
        .message,
    ).toBe("Conflicto específico");
  });
});
