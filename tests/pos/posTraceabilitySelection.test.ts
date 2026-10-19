import { describe, expect, it } from "vitest";
import type {
  PosTraceabilityCombinationDto,
  PosTraceabilityInventoryDto,
} from "@/modules/pos/application/dto/PosTraceabilityInventoryDto";
import {
  buildPosTraceabilitySelection,
  isSelectableTraceabilityCombination,
  planPosTraceabilityFefo,
  type PosTraceabilitySelectionRequirements,
} from "@/modules/pos/application/posTraceabilitySelection";
import { id, ids } from "./posFixtures";

const locationA = { id: ids.location, code: "A-01", name: "Estante A", type: "shelf" as const };
const locationB = { id: id(81), code: "B-01", name: "Estante B", type: "shelf" as const };
const firstLot: PosTraceabilityCombinationDto = {
  location: locationA,
  lot: { lotId: ids.lot, lotNumber: "LOT-001", expirationDate: "2026-12-31" },
  quantity: 2.125,
  reservedQuantity: 1,
  availableQuantity: 1.125,
  serials: [
    { serialId: id(82), serialNumber: "SER-001", locationId: ids.location, lotId: ids.lot },
    { serialId: id(83), serialNumber: "SER-002", locationId: ids.location, lotId: ids.lot },
  ],
  availableSerialCount: 2,
};
const tiedLot: PosTraceabilityCombinationDto = {
  location: locationB,
  lot: { lotId: id(84), lotNumber: "LOT-002", expirationDate: "2026-12-31" },
  quantity: 1.375,
  reservedQuantity: 1,
  availableQuantity: 0.375,
  serials: [
    { serialId: id(85), serialNumber: "SER-003", locationId: locationB.id, lotId: id(84) },
  ],
  availableSerialCount: 1,
};
const laterLot: PosTraceabilityCombinationDto = {
  location: locationB,
  lot: { lotId: id(86), lotNumber: "LOT-003", expirationDate: "2027-01-31" },
  quantity: 4,
  reservedQuantity: 0,
  availableQuantity: 4,
  serials: [
    { serialId: id(87), serialNumber: "SER-004", locationId: locationB.id, lotId: id(86) },
  ],
  availableSerialCount: 1,
};
const expiredLot: PosTraceabilityCombinationDto = {
  location: locationA,
  lot: { lotId: id(88), lotNumber: "LOT-EXP", expirationDate: "2026-10-15" },
  quantity: 3,
  reservedQuantity: 0,
  availableQuantity: 3,
  serials: [],
  availableSerialCount: 0,
};

function inventory(
  combinations: PosTraceabilityCombinationDto[] = [laterLot, tiedLot, expiredLot, firstLot],
): PosTraceabilityInventoryDto {
  return {
    branchId: ids.branch,
    productId: ids.product,
    businessDate: "2026-10-16",
    locations: [locationA, locationB],
    lots: [],
    serials: [],
    combinations,
  };
}

function requirements(
  overrides: Partial<PosTraceabilitySelectionRequirements> = {},
): PosTraceabilitySelectionRequirements {
  return {
    productId: ids.product,
    requiredBaseQuantity: 2,
    requiresLot: true,
    requiresSerial: false,
    requiresExpiration: true,
    ...overrides,
  };
}

describe("posTraceabilitySelection FEFO", () => {
  it("asigna automáticamente un único lote elegible", () => {
    const current = inventory([{ ...firstLot, availableQuantity: 3 }]);
    const result = buildPosTraceabilitySelection(current, requirements(), {
      quantities: {},
      selectedSerialIds: new Set(),
    });

    expect(result.selections).toEqual([
      expect.objectContaining({ locationId: locationA.id, lotId: ids.lot, quantity: 2 }),
    ]);
  });

  it("distribuye milésimas entre lotes y ubicaciones en orden FEFO determinista", () => {
    const current = inventory();
    const snapshot = JSON.stringify(current);
    const plan = planPosTraceabilityFefo(current, requirements({ requiredBaseQuantity: 2.5 }));

    expect(plan.complete).toBe(true);
    expect(plan.allocations.map(({ combination, quantity }) => [combination.lot?.lotNumber, quantity]))
      .toEqual([
        ["LOT-001", 1.125],
        ["LOT-002", 0.375],
        ["LOT-003", 1],
      ]);
    expect(JSON.stringify(current)).toBe(snapshot);
  });

  it("excluye vencidos y sin fecha, pero acepta el lote que vence hoy", () => {
    expect(isSelectableTraceabilityCombination(expiredLot, requirements(), "2026-10-16")).toBe(
      false,
    );
    expect(
      isSelectableTraceabilityCombination(
        { ...firstLot, lot: { ...firstLot.lot!, expirationDate: null } },
        requirements(),
        "2026-10-16",
      ),
    ).toBe(false);
    expect(
      isSelectableTraceabilityCombination(
        { ...firstLot, lot: { ...firstLot.lot!, expirationDate: "2026-10-16" } },
        requirements(),
        "2026-10-16",
      ),
    ).toBe(true);
  });

  it("informa inventario FEFO insuficiente", () => {
    const current = inventory([{ ...firstLot, availableQuantity: 0.5 }]);
    const plan = planPosTraceabilityFefo(current, requirements({ requiredBaseQuantity: 1 }));
    expect(plan).toMatchObject({ complete: false, availableBaseQuantity: 0.5 });
    expect(() =>
      buildPosTraceabilitySelection(current, requirements({ requiredBaseQuantity: 1 }), {
        quantities: {},
        selectedSerialIds: new Set(),
      }),
    ).toThrow("Inventario FEFO insuficiente");
  });

  it("conserva cantidades manuales para lotes sin seguimiento de vencimiento", () => {
    const result = buildPosTraceabilitySelection(
      inventory(),
      requirements({ requiresExpiration: false }),
      {
        quantities: {
          [`${locationA.id}:${ids.lot}`]: "1.125",
          [`${locationB.id}:${id(84)}`]: "0.375",
          [`${locationB.id}:${id(86)}`]: "0.5",
        },
        selectedSerialIds: new Set(),
      },
    );
    expect(result.selectedBaseQuantity).toBe(2);
    expect(result.selections).toHaveLength(3);
  });
});

describe("posTraceabilitySelection series", () => {
  const serialRequirements = (quantity: number) =>
    requirements({ requiredBaseQuantity: quantity, requiresSerial: true });

  it("calcula capacidad real con series y exige completar fechas anteriores", () => {
    const current = inventory([
      { ...firstLot, availableQuantity: 6 },
      { ...laterLot, availableQuantity: 4 },
    ]);
    const plan = planPosTraceabilityFefo(current, serialRequirements(3));
    expect(plan.groups.map((group) => [group.expirationDate, group.requiredQuantity])).toEqual([
      ["2026-12-31", 2],
      ["2027-01-31", 1],
    ]);

    expect(() =>
      buildPosTraceabilitySelection(current, serialRequirements(2), {
        quantities: {},
        selectedSerialIds: new Set([id(82), id(87)]),
      }),
    ).toThrow("vencimiento 31/12/2026");
  });

  it("combina series manuales con cuotas FEFO y conserva ubicación y lote", () => {
    const current = inventory([
      { ...firstLot, availableQuantity: 6 },
      { ...laterLot, availableQuantity: 4 },
    ]);
    const result = buildPosTraceabilitySelection(current, serialRequirements(3), {
      quantities: {},
      selectedSerialIds: new Set([id(82), id(83), id(87)]),
    });

    expect(result.selections).toEqual([
      expect.objectContaining({
        locationId: locationA.id,
        lotId: ids.lot,
        quantity: 2,
        serialNumbers: ["SER-001", "SER-002"],
      }),
      expect.objectContaining({
        locationId: locationB.id,
        lotId: id(86),
        quantity: 1,
        serialNumbers: ["SER-004"],
      }),
    ]);
  });

  it("permite elegir series entre lotes y ubicaciones empatados en vencimiento", () => {
    const tiedSerialLot = { ...tiedLot, availableQuantity: 1 };
    const result = buildPosTraceabilitySelection(
      inventory([{ ...firstLot, availableQuantity: 6 }, tiedSerialLot]),
      serialRequirements(1),
      { quantities: {}, selectedSerialIds: new Set([id(85)]) },
    );
    expect(result.selections).toEqual([
      expect.objectContaining({ locationId: locationB.id, lotId: id(84), serialNumbers: ["SER-003"] }),
    ]);
  });

  it("detecta series duplicadas y cantidades serializadas fraccionarias", () => {
    const duplicated = inventory([
      firstLot,
      {
        ...tiedLot,
        availableQuantity: 1,
        serials: [{ ...firstLot.serials[0], locationId: locationB.id, lotId: id(84) }],
      },
    ]);
    expect(() =>
      buildPosTraceabilitySelection(duplicated, serialRequirements(1), {
        quantities: {},
        selectedSerialIds: new Set([id(82)]),
      }),
    ).toThrow("más de una vez");

    expect(() =>
      buildPosTraceabilitySelection(inventory(), serialRequirements(1.5), {
        quantities: {},
        selectedSerialIds: new Set([id(82)]),
      }),
    ).toThrow("cantidad base entera");
  });

  it("mantiene selección manual de series cuando no existe seguimiento de vencimiento", () => {
    const serialWithoutLot = {
      ...laterLot,
      lot: null,
      availableQuantity: null,
      serials: laterLot.serials.map((serial) => ({ ...serial, lotId: null })),
    };
    const result = buildPosTraceabilitySelection(
      inventory([serialWithoutLot]),
      requirements({
        requiredBaseQuantity: 1,
        requiresLot: false,
        requiresSerial: true,
        requiresExpiration: false,
      }),
      { quantities: {}, selectedSerialIds: new Set([id(87)]) },
    );
    expect(result.selections[0]).toMatchObject({ lotId: null, serialNumbers: ["SER-004"] });
  });
});
