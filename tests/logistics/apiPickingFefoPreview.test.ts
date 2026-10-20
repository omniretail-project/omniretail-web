import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiPickingRepository } from "@/infrastructure/api/repositories/ApiPickingRepository";
import { parseApiPickingFefoPreview } from "@/infrastructure/api/repositories/pickingApi.schema";

const id = (suffix: number) =>
  `40000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = {
  tenant: id(1), branch: id(2), picking: id(3), line: id(4), product: id(5),
  location: id(6), lotA: id(7), lotB: id(8),
};

const allocation = (lotId: string, lotNumber: string, expirationDate: string, quantity: number) => ({
  locationId: ids.location,
  locationCode: "BOD-01",
  locationName: "Estante 1",
  lotId,
  lotNumber,
  expirationDate,
  quantity,
});

function response() {
  return {
    pickingOrderId: ids.picking,
    pickingLineId: ids.line,
    productId: ids.product,
    branchId: ids.branch,
    location: { id: ids.location, code: "BOD-01", name: "Estante 1" },
    currentPickedQuantity: 100,
    targetPickedQuantity: 150,
    incrementalQuantity: 50,
    existingSelections: [allocation(ids.lotA, "526397", "2027-03-13", 100)],
    incrementalAllocations: [allocation(ids.lotB, "121401", "2027-11-17", 50)],
    resultingSelections: [
      allocation(ids.lotA, "526397", "2027-03-13", 100),
      allocation(ids.lotB, "121401", "2027-11-17", 50),
    ],
    calculatedAt: "2026-10-19T14:30:00-06:00",
    provisional: true as const,
  };
}

describe("vista previa FEFO de Picking", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("consulta por GET con sucursal, ubicacion y cantidad acumulada, sin escribir", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ApiPickingRepository().getFefoPreview(
      { tenantId: ids.tenant, branchId: ids.branch },
      ids.picking,
      ids.line,
      { locationId: ids.location, pickedQuantity: 150 },
    )).resolves.toMatchObject({ incrementalQuantity: 50, provisional: true });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/backend/logistics/picking/${ids.picking}/items/${ids.line}/fefo-preview?branchId=${ids.branch}&locationId=${ids.location}&pickedQuantity=150`,
      expect.objectContaining({ method: "GET", body: undefined, cache: "no-store" }),
    );
  });

  it("valida una distribucion entre varios lotes y sus fechas", () => {
    expect(parseApiPickingFefoPreview(response()).resultingSelections).toHaveLength(2);
  });

  it.each([
    ["UUID", { pickingLineId: "linea-invalida" }],
    ["fecha local", { incrementalAllocations: [allocation(ids.lotB, "121401", "17/11/2027", 50)] }],
    ["fecha calculada", { calculatedAt: "2026-10-19T14:30:00" }],
    ["cantidad", { incrementalQuantity: -1 }],
    ["provisional", { provisional: false }],
    ["campo desconocido", { unexpected: true }],
  ])("rechaza contrato invalido: %s", (_name, patch) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      parseApiPickingFefoPreview({ ...response(), ...patch });
      throw new Error("El parser debio rechazar la respuesta.");
    } catch (error) {
      expect(error).toMatchObject({ status: 502, code: "INVALID_BACKEND_RESPONSE" });
    }
  });

  it("propaga errores HTTP y de red sin fabricar una distribucion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { code: "INSUFFICIENT_STOCK", message: "Existencia insuficiente" },
      { status: 409 },
    )));
    const repository = new ApiPickingRepository();
    await expect(repository.getFefoPreview(
      { tenantId: ids.tenant, branchId: ids.branch }, ids.picking, ids.line,
      { locationId: ids.location, pickedQuantity: 150 },
    )).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });
  });
});
