import { describe, expect, it } from "vitest";
import {
  canonicalizePosTrackingSelections,
  normalizePosTrackingQuantity,
} from "@/modules/pos/application/posTrackingSelection";
import { ids } from "./posFixtures";

describe("selecciones fisicas POS", () => {
  it("normaliza cantidades validas a la precision contractual", () => {
    expect(normalizePosTrackingQuantity(1.25)).toBe(1.25);
    expect(normalizePosTrackingQuantity(0.1 + 0.2)).toBe(0.3);
    expect(normalizePosTrackingQuantity(999_999_999.999)).toBe(999_999_999.999);
  });

  it.each([0, -1, 1.0001, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000])(
    "rechaza la cantidad fuera del contrato: %s",
    (quantity) => {
      expect(() => normalizePosTrackingQuantity(quantity)).toThrow();
    },
  );

  it("ordena selecciones y series sin mutar la entrada", () => {
    const input = [
      {
        productId: ids.product,
        locationId: ids.location,
        lotId: ids.lot,
        quantity: 2,
        serialNumbers: [" SER-002 ", "SER-001"],
      },
      {
        productId: ids.product,
        locationId: ids.branch,
        quantity: 1.5,
      },
    ];
    const snapshot = structuredClone(input);

    expect(canonicalizePosTrackingSelections(input)).toEqual([
      {
        productId: ids.product,
        locationId: ids.branch,
        lotId: null,
        quantity: 1.5,
        serialNumbers: [],
      },
      {
        productId: ids.product,
        locationId: ids.location,
        lotId: ids.lot,
        quantity: 2,
        serialNumbers: ["SER-001", "SER-002"],
      },
    ]);
    expect(input).toEqual(snapshot);
  });

  it("impide reutilizar una serie entre selecciones", () => {
    expect(() =>
      canonicalizePosTrackingSelections([
        {
          productId: ids.product,
          locationId: ids.location,
          quantity: 1,
          serialNumbers: ["SER-001"],
        },
        {
          productId: ids.product,
          locationId: ids.branch,
          quantity: 1,
          serialNumbers: [" SER-001 "],
        },
      ]),
    ).toThrow("esta repetido");
  });
});
