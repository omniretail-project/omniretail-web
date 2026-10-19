import { describe, expect, it, vi } from "vitest";
import { LocationStatus } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { GetPosTraceabilityInventoryService } from "@/modules/pos/application/services/GetPosTraceabilityInventoryService";
import { createPosRepositories, id, ids, POS_PERMISSIONS } from "./posFixtures";

const otherLocationId = id(40);
const inactiveLocationId = id(41);
const secondLotId = id(42);

function createTraceabilityRepositories(options?: {
  permissions?: string[];
  lots?: unknown[];
  serials?: unknown[];
}) {
  const locations = [
    {
      id: ids.location,
      tenantId: ids.tenant,
      branchId: ids.branch,
      code: "A-01",
      name: "Anaquel 1",
      type: "shelf",
      status: LocationStatus.active,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: otherLocationId,
      tenantId: ids.tenant,
      branchId: ids.branch,
      code: "B-01",
      name: "Anaquel 2",
      type: "shelf",
      status: LocationStatus.active,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: inactiveLocationId,
      tenantId: ids.tenant,
      branchId: ids.branch,
      code: "Z-01",
      name: "Inactiva",
      type: "shelf",
      status: LocationStatus.inactive,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ];
  const lots = options?.lots ?? [
    {
      lotId: ids.lot,
      lotNumber: "LOT-001",
      expirationDate: "2027-05-01",
      quantity: 12,
      reservedQuantity: 4,
      availableQuantity: 8,
      locationId: ids.location,
    },
    {
      lotId: secondLotId,
      lotNumber: "LOT-002",
      quantity: 5,
      reservedQuantity: 5,
      availableQuantity: 0,
      locationId: otherLocationId,
    },
  ];
  const serials = options?.serials ?? [
    {
      serialId: id(43),
      serialNumber: " SER-002 ",
      lotId: ids.lot,
      locationId: ids.location,
    },
    {
      serialId: id(44),
      serialNumber: "SER-001",
      lotId: ids.lot,
      locationId: ids.location,
    },
  ];
  const getLocations = vi.fn().mockResolvedValue(locations);
  const listAvailableLots = vi.fn().mockResolvedValue(lots);
  const listAvailableSerials = vi.fn().mockResolvedValue(serials);
  const { repositories } = createPosRepositories({
    role: {
      permissions: options?.permissions ?? [
        ...POS_PERMISSIONS,
        "inventory.stock.read",
        "catalog.locations.read",
      ],
    },
    extra: {
      inventoryStockDataSource: "api",
      inventory: { getLocations },
      inventoryAdjustments: { listAvailableLots, listAvailableSerials },
    },
  });
  return { repositories, getLocations, listAvailableLots, listAvailableSerials };
}

describe("GetPosTraceabilityInventoryService", () => {
  it("consulta repositorios existentes y relaciona ubicacion, lote, vencimiento y series", async () => {
    const fixture = createTraceabilityRepositories();

    const result = await new GetPosTraceabilityInventoryService(fixture.repositories).execute({
      branchId: ids.branch,
      productId: ids.product,
      locationId: ids.location,
      lotId: ids.lot,
    });

    expect(fixture.getLocations).toHaveBeenCalledWith(ids.branch);
    expect(fixture.listAvailableLots).toHaveBeenCalledWith({
      branchId: ids.branch,
      productId: ids.product,
      locationId: ids.location,
    });
    expect(fixture.listAvailableSerials).toHaveBeenCalledWith({
      branchId: ids.branch,
      productId: ids.product,
      locationId: ids.location,
      lotId: ids.lot,
    });
    expect(result.locations.map((location) => location.id)).toEqual([
      ids.location,
      otherLocationId,
    ]);
    expect(result.lots).toEqual([
      expect.objectContaining({
        lotId: ids.lot,
        expirationDate: "2027-05-01",
        quantity: 12,
        reservedQuantity: 4,
        availableQuantity: 8,
      }),
    ]);
    expect(result.serials.map((serial) => serial.serialNumber)).toEqual(["SER-001", "SER-002"]);
    expect(result.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.combinations).toEqual([
      expect.objectContaining({
        location: expect.objectContaining({ id: ids.location }),
        lot: expect.objectContaining({ lotId: ids.lot, expirationDate: "2027-05-01" }),
        quantity: 12,
        reservedQuantity: 4,
        availableQuantity: 8,
        availableSerialCount: 2,
      }),
    ]);
  });

  it("devuelve inventario vacio sin fabricar disponibilidad", async () => {
    const fixture = createTraceabilityRepositories({ lots: [], serials: [] });
    const result = await new GetPosTraceabilityInventoryService(fixture.repositories).execute({
      branchId: ids.branch,
      productId: ids.product,
    });

    expect(result.lots).toEqual([]);
    expect(result.serials).toEqual([]);
    expect(result.combinations).toEqual([]);
  });

  it("rechaza ubicaciones inactivas antes de consultar lotes o series", async () => {
    const fixture = createTraceabilityRepositories();

    await expect(
      new GetPosTraceabilityInventoryService(fixture.repositories).execute({
        branchId: ids.branch,
        productId: ids.product,
        locationId: inactiveLocationId,
      }),
    ).rejects.toThrow("no esta activa");
    expect(fixture.listAvailableLots).not.toHaveBeenCalled();
    expect(fixture.listAvailableSerials).not.toHaveBeenCalled();
  });

  it("exige ambos permisos y no consulta inventario en modo mock", async () => {
    const withoutLocationsPermission = createTraceabilityRepositories({
      permissions: [...POS_PERMISSIONS, "inventory.stock.read"],
    });
    await expect(
      new GetPosTraceabilityInventoryService(withoutLocationsPermission.repositories).execute({
        branchId: ids.branch,
        productId: ids.product,
      }),
    ).rejects.toThrow("No dispone de permisos");
    expect(withoutLocationsPermission.getLocations).not.toHaveBeenCalled();

    const mockMode = createTraceabilityRepositories();
    Object.assign(mockMode.repositories, { inventoryStockDataSource: "mock" });
    await expect(
      new GetPosTraceabilityInventoryService(mockMode.repositories).execute({
        branchId: ids.branch,
        productId: ids.product,
      }),
    ).rejects.toThrow("no esta activa");
    expect(mockMode.getLocations).not.toHaveBeenCalled();
  });

  it("propaga errores HTTP sin convertirlos en inventario vacio", async () => {
    const fixture = createTraceabilityRepositories();
    fixture.listAvailableLots.mockRejectedValueOnce(new BackendRequestError("Acceso denegado", 403));

    await expect(
      new GetPosTraceabilityInventoryService(fixture.repositories).execute({
        branchId: ids.branch,
        productId: ids.product,
      }),
    ).rejects.toMatchObject({ status: 403, message: "Acceso denegado" });
  });

  it("rechaza series duplicadas en una respuesta invalida", async () => {
    const fixture = createTraceabilityRepositories({
      serials: [
        {
          serialId: id(43),
          serialNumber: "SER-001",
          lotId: ids.lot,
          locationId: ids.location,
        },
        {
          serialId: id(44),
          serialNumber: " ser-001 ",
          lotId: ids.lot,
          locationId: ids.location,
        },
      ],
    });

    await expect(
      new GetPosTraceabilityInventoryService(fixture.repositories).execute({
        branchId: ids.branch,
        productId: ids.product,
      }),
    ).rejects.toThrow("vacios o duplicados");
  });
});
