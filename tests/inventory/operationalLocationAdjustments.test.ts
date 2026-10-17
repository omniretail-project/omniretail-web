import { describe, expect, it, vi } from "vitest";
import { InventoryAdjustmentType, LocationStatus } from "@/core/enums";
import { ApiInventoryAdjustmentRepository } from "@/infrastructure/api/repositories/ApiInventoryAdjustmentRepository";
import { ApiInventoryStockRepository } from "@/infrastructure/api/repositories/ApiInventoryStockRepository";
import { parseApiInventoryAlertPage } from "@/infrastructure/api/repositories/inventoryStockApi.schema";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockInventoryAdjustmentRepository } from "@/infrastructure/mock/repositories/MockInventoryAdjustmentRepository";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import {
  RegisterInventoryAdjustmentService,
  STOCK_ELSEWHERE_ADJUSTMENT_MESSAGE,
  assertAdjustmentTargetIsUnambiguous,
  resolveOperationalInventoryLocation,
  selectOperationalAdjustmentBalance,
} from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { classifyInventoryStatus } from "@/modules/inventory/application/services/GetInventoryAlertsService";

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

function createAdjustmentFixture() {
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
  const operationalLocationId: string = settings.defaultLocationId;
  const product = snapshot.products.find((item) => item.id === settings.productId);
  const location = snapshot.storageLocations.find((item) => item.id === settings.defaultLocationId);
  if (!product || !location) throw new Error("Fixture de inventario incompleto.");
  store.mutate((database) => {
    const storedProduct = database.products.find((item) => item.id === product.id)!;
    storedProduct.tracking = { stock: true, lot: false, expiration: false, serial: false };
    const capabilities = database.businessCapabilities.find(
      (item) => item.tenantId === settings.tenantId,
    );
    if (capabilities) capabilities.supportsMultipleLocations = true;
    database.inventoryBalances = database.inventoryBalances.filter(
      (item) =>
        !(
          item.tenantId === settings.tenantId &&
          item.branchId === settings.branchId &&
          item.productId === settings.productId
        ),
    );
    database.inventoryBalances.push(
      {
        id: "balance-operational-test",
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        productId: settings.productId,
        locationId: operationalLocationId,
        quantity: 5,
        reservedQuantity: 1,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "balance-other-test",
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        productId: settings.productId,
        locationId: "historical-other-location",
        quantity: 20,
        reservedQuantity: 0,
        updatedAt: new Date().toISOString(),
      },
    );
  });
  return {
    store,
    repository: new MockInventoryAdjustmentRepository(store, new DataEventBus()),
    settings,
    location,
    operationalLocationId,
  };
}

describe("operational inventory location", () => {
  it("uses only an active default location from the same product and branch", () => {
    const { settings, location } = createAdjustmentFixture();
    expect(
      resolveOperationalInventoryLocation({
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        productId: settings.productId,
        requestedLocationId: location.id,
        usesLocations: true,
        settings,
        locations: [location],
      }),
    ).toBe(location.id);

    expect(() =>
      resolveOperationalInventoryLocation({
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        productId: settings.productId,
        requestedLocationId: location.id,
        usesLocations: true,
        settings,
        locations: [{ ...location, status: LocationStatus.inactive }],
      }),
    ).toThrow("no esta activa");
  });

  it("does not invent a physical UUID when locations are disabled", () => {
    expect(
      resolveOperationalInventoryLocation({
        tenantId: "tenant",
        branchId: "branch",
        productId: "product",
        requestedLocationId: "physical-location",
        usesLocations: false,
        settings: null,
        locations: [],
      }),
    ).toBeUndefined();
  });
});

const apiTenant = "30000000-0000-4000-8000-000000000001";
const apiBranch = "30000000-0000-4000-8000-000000000002";
const productLow = "20000000-0000-4000-8000-000000000001";
const productTarget = "40000000-0000-4000-8000-000000000001";
const productHigh = "60000000-0000-4000-8000-000000000001";
const assignedLocation = "50000000-0000-4000-8000-000000000001";
const otherLocation = "50000000-0000-4000-8000-000000000002";

function domainBalance(
  id: string,
  locationId: string | undefined,
  quantity: number,
  reservedQuantity = 0,
) {
  return {
    id,
    tenantId: apiTenant,
    branchId: apiBranch,
    productId: productTarget,
    ...(locationId ? { locationId } : {}),
    quantity,
    reservedQuantity,
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

function operationalSettings(defaultLocationId: string | null) {
  return {
    id: "settings-1",
    tenantId: apiTenant,
    branchId: apiBranch,
    productId: productTarget,
    minStock: 0,
    defaultLocationId,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

function locationRecord(id: string, status = LocationStatus.active) {
  return {
    id,
    tenantId: apiTenant,
    branchId: apiBranch,
    code: id.slice(-2),
    name: id,
    type: "warehouse" as const,
    status,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

describe("selectOperationalAdjustmentBalance (API and mock share it)", () => {
  const base = { tenantId: apiTenant, branchId: apiBranch, productId: productTarget };

  it("takes quantity and reserved only from the assigned balance, never the branch aggregate", () => {
    const result = selectOperationalAdjustmentBalance({
      ...base,
      usesLocations: true,
      settings: operationalSettings(assignedLocation),
      locations: [locationRecord(assignedLocation), locationRecord(otherLocation)],
      balances: [
        domainBalance("b1", assignedLocation, 40, 6),
        domainBalance("b2", otherLocation, 268),
        domainBalance("b3", undefined, 0),
      ],
    });

    expect(result).toEqual({
      locationId: assignedLocation,
      quantity: 40,
      availableQuantity: 34,
      hasStockElsewhere: true,
    });
  });

  it("blocks entries and counts, but not exits, when stock sits in another balance", () => {
    const ambiguous = { hasStockElsewhere: true };
    expect(() => assertAdjustmentTargetIsUnambiguous("in", ambiguous)).toThrow(
      STOCK_ELSEWHERE_ADJUSTMENT_MESSAGE,
    );
    expect(() => assertAdjustmentTargetIsUnambiguous("count", ambiguous)).toThrow(
      STOCK_ELSEWHERE_ADJUSTMENT_MESSAGE,
    );
    expect(() => assertAdjustmentTargetIsUnambiguous("out", ambiguous)).not.toThrow();
    expect(() => assertAdjustmentTargetIsUnambiguous("waste", ambiguous)).not.toThrow();
    expect(() =>
      assertAdjustmentTargetIsUnambiguous("count", { hasStockElsewhere: false }),
    ).not.toThrow();
  });

  it("lets a legacy product without assignment keep operating its NULL balance", () => {
    const result = selectOperationalAdjustmentBalance({
      ...base,
      usesLocations: true,
      settings: null,
      locations: [locationRecord(assignedLocation)],
      balances: [domainBalance("legacy", undefined, 4, 1)],
    });

    expect(result).toEqual({
      locationId: undefined,
      quantity: 4,
      availableQuantity: 3,
      hasStockElsewhere: false,
    });
  });

  it("refuses an unassigned product that has no NULL balance instead of picking a location", () => {
    expect(() =>
      selectOperationalAdjustmentBalance({
        ...base,
        usesLocations: true,
        settings: operationalSettings(null),
        locations: [locationRecord(assignedLocation), locationRecord(otherLocation)],
        balances: [domainBalance("b2", otherLocation, 20)],
      }),
    ).toThrow("Configura una ubicacion operativa");
  });

  it("never operates a legacy NULL balance when the caller asks for a specific location", () => {
    expect(() =>
      selectOperationalAdjustmentBalance({
        ...base,
        usesLocations: true,
        requestedLocationId: otherLocation,
        settings: null,
        locations: [locationRecord(otherLocation)],
        balances: [domainBalance("legacy", undefined, 4)],
      }),
    ).toThrow("Configura una ubicacion operativa");
  });

  it("uses the NULL balance when locations are disabled and treats located stock as elsewhere", () => {
    const result = selectOperationalAdjustmentBalance({
      ...base,
      usesLocations: false,
      requestedLocationId: assignedLocation,
      settings: operationalSettings(assignedLocation),
      locations: [],
      balances: [domainBalance("legacy", undefined, 4), domainBalance("b1", assignedLocation, 9)],
    });

    expect(result.locationId).toBeUndefined();
    expect(result.quantity).toBe(4);
    expect(result.hasStockElsewhere).toBe(true);
  });
});

describe("RegisterInventoryAdjustmentService operational read reuse", () => {
  function registry() {
    return {
      inventory: {
        getProductInventorySettings: vi.fn(async () => operationalSettings(assignedLocation)),
        getLocations: vi.fn(async () => [locationRecord(assignedLocation)]),
        getProductBalances: vi.fn(async () => [domainBalance("balance", assignedLocation, 5)]),
      },
    } as unknown as RepositoryRegistry;
  }

  it("reuses page locations for the modal but bypasses every snapshot for confirmation", async () => {
    const repositories = registry();
    const service = new RegisterInventoryAdjustmentService(repositories);

    await service.resolveOperationalBalance({
      tenantId: apiTenant,
      branchId: apiBranch,
      productId: productTarget,
      movementKind: "out",
      usesLocations: true,
      knownLocations: [locationRecord(assignedLocation)],
    });
    expect(repositories.inventory.getLocations).not.toHaveBeenCalled();
    expect(repositories.inventory.getProductBalances).toHaveBeenLastCalledWith(
      productTarget,
      apiBranch,
      apiTenant,
      undefined,
    );

    await service.resolveOperationalBalance({
      tenantId: apiTenant,
      branchId: apiBranch,
      productId: productTarget,
      movementKind: "out",
      usesLocations: true,
      knownLocations: [locationRecord(assignedLocation)],
      fresh: true,
    });
    expect(repositories.inventory.getLocations).toHaveBeenCalledOnce();
    expect(repositories.inventory.getProductBalances).toHaveBeenLastCalledWith(
      productTarget,
      apiBranch,
      apiTenant,
      { fresh: true },
    );
  });
});

describe("ApiInventoryStockRepository.getProductBalances (GET /inventory/balances)", () => {
  function pageOf(
    items: Array<{
      productId: string;
      locationId: string | null;
      quantity: number;
      reserved?: number;
    }>,
    page: number,
    totalPages: number,
    totalItems = items.length,
    pageSize = 2_000,
    tenantId = apiTenant,
  ) {
    return Response.json({
      items: items.map((item, index) => ({
        id: `70000000-0000-4000-8000-${String(page * 100 + index).padStart(12, "0")}`,
        tenantId,
        branchId: apiBranch,
        productId: item.productId,
        locationId: item.locationId,
        quantity: item.quantity,
        reservedQuantity: item.reserved ?? 0,
        updatedAt: "2026-10-09T00:00:00.000Z",
      })),
      page,
      pageSize,
      totalItems,
      totalPages,
    });
  }

  it("uses one filtered request and does not depend on backend ordering", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        pageOf(
          [
            { productId: productTarget, locationId: assignedLocation, quantity: 40 },
            { productId: productTarget, locationId: null, quantity: 4, reserved: 1 },
          ],
          1,
          1,
          2,
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const balances = await new ApiInventoryStockRepository().getProductBalances(
      productTarget,
      apiBranch,
      apiTenant,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(url.pathname).toBe("/api/backend/inventory/balances");
    expect(url.searchParams.get("branchId")).toBe(apiBranch);
    expect(url.searchParams.get("productId")).toBe(productTarget);
    expect(url.searchParams.get("size")).toBe("2000");
    expect(url.searchParams.has("sort")).toBe(false);
    expect(balances.map((balance) => [balance.locationId, balance.quantity])).toEqual([
      [assignedLocation, 40],
      [undefined, 4],
    ]);
    expect(balances[1].reservedQuantity).toBe(1);
    expect("locationId" in balances[1]).toBe(false);
  });

  it("completes a bounded legacy response in parallel when productId is ignored", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const page = Number(new URL(String(input), "http://localhost").searchParams.get("page"));
      return pageOf(
        page === 1
          ? [
              { productId: productHigh, locationId: assignedLocation, quantity: 7 },
              { productId: productTarget, locationId: assignedLocation, quantity: 40 },
            ]
          : [
              { productId: productTarget, locationId: otherLocation, quantity: 268 },
              { productId: productLow, locationId: assignedLocation, quantity: 99 },
            ],
        page,
        2,
        4,
        2,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const balances = await new ApiInventoryStockRepository().getProductBalances(
      productTarget,
      apiBranch,
      apiTenant,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(balances.map((balance) => balance.quantity)).toEqual([40, 268]);
  });

  it("deduplicates concurrent consumers, caches briefly and invalidates on stock.changed", async () => {
    const eventBus = new DataEventBus();
    let release!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () =>
        pageOf([{ productId: productTarget, locationId: null, quantity: 5 }], 1, 1, 1),
      );
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiInventoryStockRepository(eventBus);

    const first = repository.getProductBalances(productTarget, apiBranch, apiTenant);
    const second = repository.getProductBalances(productTarget, apiBranch, apiTenant);
    expect(fetchMock).toHaveBeenCalledOnce();
    release(pageOf([{ productId: productTarget, locationId: null, quantity: 4 }], 1, 1, 1));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await repository.getProductBalances(productTarget, apiBranch, apiTenant);
    expect(fetchMock).toHaveBeenCalledOnce();

    eventBus.emit("stock.changed", {
      tenantId: apiTenant,
      branchId: apiBranch,
      productId: productTarget,
    });
    await repository.getProductBalances(productTarget, apiBranch, apiTenant);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await repository.getProductBalances(productTarget, apiBranch, apiTenant, { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails instead of returning a partial list when the read cannot be completed", async () => {
    const fetchMock = vi.fn(async () =>
      pageOf([{ productId: productLow, locationId: assignedLocation, quantity: 1 }], 1, 4, 8_000),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ApiInventoryStockRepository().getProductBalances(productTarget, apiBranch, apiTenant),
    ).rejects.toMatchObject({ code: "INVENTORY_BALANCES_INCOMPLETE" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an empty intermediate page instead of treating it as a complete response", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const page = Number(new URL(String(input), "http://localhost").searchParams.get("page"));
      return page === 1
        ? pageOf([{ productId: productTarget, locationId: null, quantity: 1 }], 1, 2, 2, 1)
        : pageOf([], 2, 2, 2, 1);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ApiInventoryStockRepository().getProductBalances(productTarget, apiBranch, apiTenant),
    ).rejects.toMatchObject({ code: "INVENTORY_BALANCES_INCOMPLETE" });
  });

  it("rejects a balance outside the requested tenant or branch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        pageOf(
          [{ productId: productTarget, locationId: null, quantity: 1 }],
          1,
          1,
          1,
          2_000,
          "90000000-0000-4000-8000-000000000099",
        ),
      ),
    );

    await expect(
      new ApiInventoryStockRepository().getProductBalances(productTarget, apiBranch, apiTenant),
    ).rejects.toMatchObject({ code: "INVENTORY_BALANCES_SCOPE_MISMATCH" });
  });
});

describe("inventory alert contracts", () => {
  it("accepts a backend alert with no configured reorder point", () => {
    const page = parseApiInventoryAlertPage({
      items: [
        {
          productId: productTarget,
          branchId: apiBranch,
          sku: "SKU-1",
          productName: "Producto",
          baseUnitId: "80000000-0000-4000-8000-000000000001",
          quantity: 5,
          reservedQuantity: 2,
          availableQuantity: 3,
          minStock: 4,
          reorderPoint: null,
          defaultLocationId: null,
          status: "critical",
          suggestedReorder: 1,
        },
      ],
      page: 1,
      pageSize: 100,
      totalItems: 1,
      totalPages: 1,
    });

    expect(page.items[0].reorderPoint).toBeNull();
    expect(page.items[0].availableQuantity).toBe(3);
  });

  it("rejects a NULL quantity instead of coercing it to zero", () => {
    expect(() =>
      parseApiInventoryAlertPage({
        items: [
          {
            productId: productTarget,
            branchId: apiBranch,
            sku: "SKU-1",
            productName: "Producto",
            baseUnitId: "80000000-0000-4000-8000-000000000001",
            quantity: null,
            reservedQuantity: 0,
            availableQuantity: 0,
            minStock: 0,
            reorderPoint: null,
            defaultLocationId: null,
            status: "out_of_stock",
            suggestedReorder: 0,
          },
        ],
        page: 1,
        pageSize: 100,
        totalItems: 1,
        totalPages: 1,
      }),
    ).toThrow();
  });

  it("uses reorderPoint when configured and the 1.25 fallback only when absent", () => {
    expect(classifyInventoryStatus(0, 10, 20)).toBe("out_of_stock");
    expect(classifyInventoryStatus(9, 10, 20)).toBe("critical");
    expect(classifyInventoryStatus(15, 10, 20)).toBe("near_minimum");
    expect(classifyInventoryStatus(12.5, 10, null)).toBe("near_minimum");
    expect(classifyInventoryStatus(13, 10, null)).toBe("normal");
  });
});

describe("ApiInventoryAdjustmentRepository payload for the operational balance", () => {
  it("sends only the delta of the target balance and omits locationId for the NULL balance", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({}),
    );
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiInventoryAdjustmentRepository(new DataEventBus());

    await repository.registerStockAdjustment({
      tenantId: apiTenant,
      branchId: apiBranch,
      productId: productTarget,
      type: InventoryAdjustmentType.countCorrection,
      reason: "Conteo balance NULL",
      quantityBefore: 4,
      quantityAfter: 6,
      expectedQuantity: 4,
    });
    await repository.registerStockAdjustment({
      tenantId: apiTenant,
      branchId: apiBranch,
      productId: productTarget,
      locationId: assignedLocation,
      type: InventoryAdjustmentType.manualDecrease,
      reason: "Salida ubicacion operativa",
      quantityBefore: 40,
      quantityAfter: 38,
    });

    const [nullCall, locatedCall] = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
    );
    expect(nullCall).toMatchObject({ type: "in", quantity: 2, expectedQuantity: 4 });
    expect("locationId" in nullCall).toBe(false);
    expect(locatedCall).toMatchObject({ type: "out", quantity: 2, locationId: assignedLocation });
    expect("expectedQuantity" in locatedCall).toBe(false);
  });
});

describe("MockInventoryAdjustmentRepository operational balance", () => {
  it("calculates quantityBefore from the target location instead of all balances", async () => {
    const { repository, store, settings, operationalLocationId } = createAdjustmentFixture();
    const result = await repository.registerStockAdjustment({
      tenantId: settings.tenantId,
      branchId: settings.branchId,
      productId: settings.productId,
      locationId: operationalLocationId,
      type: InventoryAdjustmentType.manualIncrease,
      reason: "Conteo operativo",
      quantityBefore: 5,
      quantityAfter: 6,
    });

    expect(result.adjustment).toMatchObject({ quantityBefore: 5, quantityAfter: 6, delta: 1 });
    expect(
      store.getSnapshot().inventoryBalances.find((item) => item.id === "balance-operational-test")
        ?.quantity,
    ).toBe(6);
    expect(
      store.getSnapshot().inventoryBalances.find((item) => item.id === "balance-other-test")
        ?.quantity,
    ).toBe(20);
  });

  it("rejects an adjustment in a location different from the configured one", async () => {
    const { repository, store, settings, location } = createAdjustmentFixture();
    const otherLocationId = "active-other-location";
    store.mutate((database) => {
      database.storageLocations.push({ ...location, id: otherLocationId });
    });

    await expect(
      repository.registerStockAdjustment({
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        productId: settings.productId,
        locationId: otherLocationId,
        type: InventoryAdjustmentType.manualIncrease,
        reason: "Ubicacion incorrecta",
        quantityBefore: 0,
        quantityAfter: 1,
      }),
    ).rejects.toThrow("active operational location");
  });

  it("updates the legacy NULL balance when multiple locations are disabled", async () => {
    const { repository, store, settings } = createAdjustmentFixture();
    store.mutate((database) => {
      const capabilities = database.businessCapabilities.find(
        (item) => item.tenantId === settings.tenantId,
      );
      if (capabilities) capabilities.supportsMultipleLocations = false;
      database.inventoryBalances = database.inventoryBalances.filter(
        (item) =>
          !(
            item.tenantId === settings.tenantId &&
            item.branchId === settings.branchId &&
            item.productId === settings.productId
          ),
      );
      database.inventoryBalances.push({
        id: "balance-null-test",
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        productId: settings.productId,
        quantity: 4,
        reservedQuantity: 0,
        updatedAt: new Date().toISOString(),
      });
    });

    await repository.registerStockAdjustment({
      tenantId: settings.tenantId,
      branchId: settings.branchId,
      productId: settings.productId,
      type: InventoryAdjustmentType.manualIncrease,
      reason: "Compatibilidad legacy",
      quantityBefore: 4,
      quantityAfter: 5,
    });

    expect(
      store.getSnapshot().inventoryBalances.find((item) => item.id === "balance-null-test")
        ?.quantity,
    ).toBe(5);
  });

  it("rejects a stale exact count but applies a manual delta against the current balance", async () => {
    const { repository, store, settings, operationalLocationId } = createAdjustmentFixture();

    await expect(
      repository.registerStockAdjustment({
        tenantId: settings.tenantId,
        branchId: settings.branchId,
        productId: settings.productId,
        locationId: operationalLocationId,
        type: InventoryAdjustmentType.countCorrection,
        reason: "Conteo stale",
        quantityBefore: 4,
        quantityAfter: 7,
        expectedQuantity: 4,
      }),
    ).rejects.toThrow("COUNT_SNAPSHOT_STALE");

    const manual = await repository.registerStockAdjustment({
      tenantId: settings.tenantId,
      branchId: settings.branchId,
      productId: settings.productId,
      locationId: operationalLocationId,
      type: InventoryAdjustmentType.manualIncrease,
      reason: "Entrada manual",
      quantityBefore: 1,
      quantityAfter: 3,
    });

    expect(manual.adjustment).toMatchObject({ quantityBefore: 5, quantityAfter: 7, delta: 2 });
    expect(
      store.getSnapshot().inventoryBalances.find((item) => item.id === "balance-operational-test")
        ?.quantity,
    ).toBe(7);
  });
});
