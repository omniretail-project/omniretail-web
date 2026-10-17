import { describe, expect, it } from "vitest";
import type { SaleTicketItemDto } from "@/modules/pos/application/dto/SaleTicketDto";
import { validateSaleTicketTraceability } from "@/modules/pos/application/validateSaleTicketTraceability";
import { id } from "./posFixtures";

function item(overrides: Partial<SaleTicketItemDto> = {}): SaleTicketItemDto {
  return {
    productId: id(1),
    sku: "TRZ-001",
    name: "Producto trazable",
    quantity: 1,
    baseUnitPrice: 10,
    unitPrice: 10,
    discount: 0,
    subtotal: 10,
    availableQuantity: 20,
    baseUnitId: id(2),
    baseQuantity: 2,
    saleUnitToBaseFactor: 2,
    saleUnitId: id(3),
    saleUnitName: "Caja",
    tracksStock: true,
    requiresTraceabilitySelection: true,
    requiresLot: true,
    requiresSerial: true,
    requiresExpiration: true,
    requiresUnsupportedTraceability: false,
    trackingSelections: [
      {
        productId: id(1),
        locationId: id(4),
        lotId: id(5),
        quantity: 2,
        serialNumbers: ["SER-001", "SER-002"],
      },
    ],
    ...overrides,
  };
}

describe("validateSaleTicketTraceability", () => {
  it("acepta una línea serializada completa y una venta mixta", () => {
    const ordinary = item({
      productId: id(10),
      name: "Producto ordinario",
      baseQuantity: undefined,
      saleUnitToBaseFactor: 1,
      requiresTraceabilitySelection: false,
      requiresLot: false,
      requiresSerial: false,
      requiresExpiration: false,
      trackingSelections: undefined,
    });

    expect(() => validateSaleTicketTraceability([ordinary, item()])).not.toThrow();
  });

  it("acepta FEFO distribuido entre varios lotes sin series", () => {
    expect(() =>
      validateSaleTicketTraceability([
        item({
          quantity: 3,
          baseQuantity: 3,
          saleUnitToBaseFactor: 1,
          requiresSerial: false,
          trackingSelections: [
            { productId: id(1), locationId: id(4), lotId: id(5), quantity: 1 },
            { productId: id(1), locationId: id(6), lotId: id(7), quantity: 2 },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  it.each([
    ["sin selección", { trackingSelections: [] }, "completar la selección"],
    [
      "cantidad incompleta",
      {
        trackingSelections: [
          {
            productId: id(1),
            locationId: id(4),
            lotId: id(5),
            quantity: 1,
            serialNumbers: ["SER-001"],
          },
        ],
      },
      "no cubre exactamente",
    ],
    [
      "producto ajeno",
      {
        trackingSelections: [
          {
            productId: id(99),
            locationId: id(4),
            lotId: id(5),
            quantity: 2,
            serialNumbers: ["SER-001", "SER-002"],
          },
        ],
      },
      "otro producto",
    ],
    [
      "lote faltante",
      {
        requiresLot: true,
        trackingSelections: [
          {
            productId: id(1),
            locationId: id(4),
            quantity: 2,
            serialNumbers: ["SER-001", "SER-002"],
          },
        ],
      },
      "control de lotes",
    ],
    [
      "series incompletas",
      {
        trackingSelections: [
          {
            productId: id(1),
            locationId: id(4),
            lotId: id(5),
            quantity: 2,
            serialNumbers: ["SER-001"],
          },
        ],
      },
      "no cubren",
    ],
    ["conversión alterada", { saleUnitToBaseFactor: 3 }, "conversión"],
    ["kit trazable", { isKit: true }, "kit con trazabilidad"],
  ])("rechaza %s", (_label, overrides, message) => {
    expect(() =>
      validateSaleTicketTraceability([item(overrides as Partial<SaleTicketItemDto>)]),
    ).toThrow(message);
  });

  it("rechaza series duplicadas entre líneas distintas", () => {
    expect(() =>
      validateSaleTicketTraceability([
        item(),
        item({
          productId: id(20),
          trackingSelections: [
            {
              productId: id(20),
              locationId: id(21),
              lotId: id(22),
              quantity: 2,
              serialNumbers: ["ser-001", "SER-003"],
            },
          ],
        }),
      ]),
    ).toThrow("duplicada en el ticket");
  });

  it("rechaza trazabilidad artificial en una línea ordinaria", () => {
    expect(() =>
      validateSaleTicketTraceability([item({ requiresTraceabilitySelection: false })]),
    ).toThrow("no corresponde a una línea trazable");
  });
});
