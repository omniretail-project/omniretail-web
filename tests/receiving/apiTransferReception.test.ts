import { describe, expect, it } from "vitest";
import { LocationStatus, ProductStatus, ProductType } from "@/core/enums";
import type { Product, StorageLocation } from "@/core/entities";
import type { ReceivingDocumentLine } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import { buildApiTransferReception } from "@/modules/receiving/application/services/ReceivingDocumentDetailService";

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const productId = "10000000-0000-4000-8000-000000000003";
const secondProductId = "10000000-0000-4000-8000-000000000004";
const firstLocationId = "10000000-0000-4000-8000-000000000005";
const secondLocationId = "10000000-0000-4000-8000-000000000006";
const now = "2026-10-14T12:00:00.000Z";

function product(id: string): Product {
  return {
    id,
    tenantId,
    sku: `SKU-${id.at(-1)}`,
    name: `Producto ${id.at(-1)}`,
    productType: ProductType.physical,
    categoryId: "10000000-0000-4000-8000-000000000010",
    baseUnitId: "10000000-0000-4000-8000-000000000011",
    salePrice: 1,
    status: ProductStatus.published,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    channels: { ecommerce: false, pos: false, mobileApp: false },
    createdAt: now,
    updatedAt: now,
  };
}

function location(id: string): StorageLocation {
  return {
    id,
    tenantId,
    branchId,
    code: id === firstLocationId ? "A-01" : "B-01",
    name: id === firstLocationId ? "Estante A" : "Estante B",
    type: "shelf",
    status: LocationStatus.active,
    createdAt: now,
    updatedAt: now,
  };
}

function line(overrides: Partial<ReceivingDocumentLine> = {}): ReceivingDocumentLine {
  return {
    id: "transfer-item-1",
    sourceLineId: "transfer-item-1",
    productId,
    productName: "Martillo",
    sku: "MAR-1",
    unitId: "10000000-0000-4000-8000-000000000011",
    unitName: "Unidad",
    unitAllowsDecimals: false,
    baseUnitId: "10000000-0000-4000-8000-000000000011",
    baseUnitName: "Unidad",
    baseUnitAllowsDecimals: false,
    orderedQuantity: 5,
    acceptedPreviously: 0,
    receivedNow: 0,
    pendingQuantity: 5,
    locationId: firstLocationId,
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

describe("API transfer reception rules", () => {
  it("resolves one shared active destination location for non-traceable products", () => {
    const resolved = buildApiTransferReception({
      lines: [
        line(),
        line({
          id: "transfer-item-2",
          sourceLineId: "transfer-item-2",
          productId: secondProductId,
        }),
      ],
      transferIsReceivable: true,
      activeLocationById: new Map([[firstLocationId, location(firstLocationId)]]),
      productById: new Map([
        [productId, product(productId)],
        [secondProductId, product(secondProductId)],
      ]),
    });

    expect(resolved).toMatchObject({
      canConfirmTransfer: true,
      requiresSingleDestinationLocation: true,
      destinationLocationId: firstLocationId,
      blockedLineIds: [],
    });
  });

  it("blocks a confirmation when pending products resolve to different locations", () => {
    const resolved = buildApiTransferReception({
      lines: [
        line(),
        line({
          id: "transfer-item-2",
          sourceLineId: "transfer-item-2",
          productId: secondProductId,
          locationId: secondLocationId,
        }),
      ],
      transferIsReceivable: true,
      activeLocationById: new Map([
        [firstLocationId, location(firstLocationId)],
        [secondLocationId, location(secondLocationId)],
      ]),
      productById: new Map([
        [productId, product(productId)],
        [secondProductId, product(secondProductId)],
      ]),
    });

    expect(resolved.canConfirmTransfer).toBe(false);
    expect(resolved.blockedLineIds).toEqual(["transfer-item-1", "transfer-item-2"]);
    expect(resolved.blockingReason).toMatch(/ubicaciones operativas diferentes/i);
  });

  it("blocks a traceable product until Backend exposes its dispatched selections", () => {
    const resolved = buildApiTransferReception({
      lines: [line({ tracking: { stock: true, lot: true, expiration: false, serial: false } })],
      transferIsReceivable: true,
      activeLocationById: new Map([[firstLocationId, location(firstLocationId)]]),
      productById: new Map([[productId, product(productId)]]),
    });

    expect(resolved.canConfirmTransfer).toBe(false);
    expect(resolved.traceabilityBlockedLineIds).toEqual(["transfer-item-1"]);
    expect(resolved.blockingReason).toMatch(/selecciones físicas despachadas/i);
  });

  it("blocks a product without an active configured destination location", () => {
    const resolved = buildApiTransferReception({
      lines: [line({ locationId: "" })],
      transferIsReceivable: true,
      activeLocationById: new Map(),
      productById: new Map([[productId, product(productId)]]),
    });

    expect(resolved.canConfirmTransfer).toBe(false);
    expect(resolved.blockedLineIds).toEqual(["transfer-item-1"]);
    expect(resolved.blockingReason).toMatch(/ubicación operativa activa/i);
  });

  it("blocks a transfer that is not receivable or has no pending quantities", () => {
    const notReceivable = buildApiTransferReception({
      lines: [line()],
      transferIsReceivable: false,
      activeLocationById: new Map([[firstLocationId, location(firstLocationId)]]),
      productById: new Map([[productId, product(productId)]]),
    });
    const noPending = buildApiTransferReception({
      lines: [line({ pendingQuantity: 0 })],
      transferIsReceivable: true,
      activeLocationById: new Map([[firstLocationId, location(firstLocationId)]]),
      productById: new Map([[productId, product(productId)]]),
    });

    expect(notReceivable.blockingReason).toMatch(/debe estar en tránsito/i);
    expect(noPending.blockingReason).toMatch(/no tiene productos pendientes/i);
  });

  it("blocks a line whose product configuration cannot be loaded", () => {
    const resolved = buildApiTransferReception({
      lines: [line()],
      transferIsReceivable: true,
      activeLocationById: new Map([[firstLocationId, location(firstLocationId)]]),
      productById: new Map(),
    });

    expect(resolved).toMatchObject({
      canConfirmTransfer: false,
      blockedLineIds: ["transfer-item-1"],
      blockingReason: expect.stringMatching(/no se pudo consultar/i),
    });
  });
});
