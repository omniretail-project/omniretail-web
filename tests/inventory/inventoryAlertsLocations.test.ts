import { describe, expect, it, vi } from "vitest";
import type { Branch, Product, Role, StorageLocation, User } from "@/core/entities";
import {
  BranchStatus,
  BranchType,
  ProductStatus,
  ProductType,
  RoleStatus,
  TenantStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetInventoryAlertsService } from "@/modules/inventory/application/services/GetInventoryAlertsService";

const TENANT_ID = "tenant-1";
const BRANCH_ID = "branch-1";
const PRODUCT_ID = "product-1";
const NOW = "2026-10-13T12:00:00.000Z";

function location(id: string, name: string): StorageLocation {
  return {
    id,
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    code: id,
    name,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as StorageLocation;
}

function alertItem(overrides: Record<string, unknown> = {}) {
  return {
    productId: PRODUCT_ID,
    branchId: BRANCH_ID,
    sku: "TAL-001",
    productName: "Taladro",
    baseUnitId: "unit-1",
    quantity: 1,
    reservedQuantity: 0,
    availableQuantity: 1,
    minStock: 5,
    reorderPoint: null,
    defaultLocationId: "loc-a",
    status: "critical",
    suggestedReorder: 4,
    ...overrides,
  };
}

function stockItem(overrides: Record<string, unknown> = {}) {
  return {
    productType: "physical",
    inventoryMode: "TRACKED",
    displayStatus: "CRITICAL",
    productId: PRODUCT_ID,
    branchId: BRANCH_ID,
    sku: "TAL-001",
    productName: "Taladro",
    categoryId: "category-1",
    categoryName: "Herramientas",
    baseUnitId: "unit-1",
    inventoryUnitId: "unit-1",
    saleUnitId: "unit-1",
    inventoryToBaseFactor: 1,
    saleToBaseFactor: 1,
    quantity: 2,
    reservedQuantity: 1,
    availableQuantity: 1,
    minStock: 5,
    reorderPoint: null,
    defaultLocationId: "loc-a",
    defaultLocationName: "Pasillo A",
    status: "critical",
    suggestedReorder: 3,
    ...overrides,
  };
}

function setup({
  capabilities = { supportsMultipleLocations: true } as { supportsMultipleLocations: boolean } | null,
  alerts = [alertItem()] as unknown[],
  stockItems = [stockItem()] as unknown[],
  stockSource = "api" as "api" | "mock",
  productTenantId = TENANT_ID,
} = {}) {
  const user: User = {
    id: "user-1",
    tenantId: TENANT_ID,
    name: "Ana",
    email: "ana@example.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "role-1",
    allowedBranchIds: [BRANCH_ID],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const role: Role = {
    id: "role-1",
    tenantId: TENANT_ID,
    name: "Inventario",
    isSystem: false,
    permissions: ["inventory.stock.read"],
    branchScope: "selected",
    status: RoleStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const branch: Branch = {
    id: BRANCH_ID,
    tenantId: TENANT_ID,
    code: "B1",
    name: "Central",
    type: BranchType.store,
    status: BranchStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const product = {
    id: PRODUCT_ID,
    tenantId: productTenantId,
    sku: "TAL-001",
    name: "Taladro",
    productType: ProductType.physical,
    categoryId: "category-1",
    baseUnitId: "unit-1",
    salePrice: 100,
    status: ProductStatus.published,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    channels: { ecommerce: true, pos: true, mobileApp: false },
    createdAt: NOW,
    updatedAt: NOW,
  } as Product;
  const getCapabilities = vi.fn(async () => capabilities);
  const getLocations = vi.fn(async () => [location("loc-a", "Pasillo A")]);
  const getInventoryAlertPage = vi.fn(async () => ({
    items: alerts,
    page: 1,
    pageSize: 100,
    totalItems: alerts.length,
    totalPages: 1,
  }));
  const getStockPage = vi.fn(async () => ({
    items: stockItems,
    page: 1,
    pageSize: 100,
    totalItems: stockItems.length,
    totalPages: 1,
    summary: { activeProducts: 1, lowStock: 1, outOfStock: 0 },
  }));
  const registry = {
    inventoryStockDataSource: stockSource,
    inventoryTransfersDataSource: "mock",
    auth: {
      getCurrentSessionId: async () => "session-1",
      getSession: async () => ({ id: "session-1", userId: user.id }),
    },
    users: { getById: async () => user },
    roles: { getByIdScoped: async () => role },
    tenants: { getById: async () => ({ id: TENANT_ID, status: TenantStatus.active }) },
    branches: { getById: async () => branch, getAll: async () => [branch] },
    businessConfig: { getCapabilities },
    categories: { getByTenant: async () => [] },
    units: { getByTenant: async () => [] },
    products: { getById: async (id: string) => (id === PRODUCT_ID ? product : null) },
    inventory: { getLocations, getInventoryAlertPage, getStockPage },
  };
  return {
    service: new GetInventoryAlertsService(registry as unknown as RepositoryRegistry),
    getCapabilities,
    getLocations,
    getInventoryAlertPage,
    getStockPage,
  };
}

const ALERT_PARAMS = { branchId: BRANCH_ID, branchName: "Central" };

type AlertsPage = Awaited<ReturnType<GetInventoryAlertsService["getApiAlerts"]>>;

function firstAlertRow(page: AlertsPage) {
  const row = page.items[0]?.row;

  if (row == null) {
    throw new Error("Expected the alerts page to contain an alert with a row");
  }

  return row;
}

describe("GetInventoryAlertsService API alerts and operational locations", () => {
  it("names the habitual location from the branch locations", async () => {
    const { service, getLocations } = setup();

    const page = await service.getApiAlerts(ALERT_PARAMS);
    const row = firstAlertRow(page);

    expect(getLocations).toHaveBeenCalledWith(BRANCH_ID);
    expect(row.defaultLocationId).toBe("loc-a");
    expect(row.defaultLocationName).toBe("Pasillo A");
  });

  it("says the location is unavailable when the assigned one is not an active branch location", async () => {
    const { service } = setup({ alerts: [alertItem({ defaultLocationId: "loc-removed" })] });

    const page = await service.getApiAlerts(ALERT_PARAMS);

    expect(firstAlertRow(page).defaultLocationName).toBe("Ubicacion no disponible");
  });

  it("does not invent a location for a product without an operational assignment", async () => {
    const { service } = setup({ alerts: [alertItem({ defaultLocationId: null })] });

    const page = await service.getApiAlerts(ALERT_PARAMS);
    const row = firstAlertRow(page);

    expect(row.defaultLocationId).toBeNull();
    expect(row.defaultLocationName).toBe("Sin ubicacion habitual");
  });

  it("skips the locations endpoint when multiple locations are disabled", async () => {
    const { service, getLocations } = setup({ capabilities: { supportsMultipleLocations: false } });

    const page = await service.getApiAlerts(ALERT_PARAMS);

    expect(getLocations).not.toHaveBeenCalled();
    expect(firstAlertRow(page).defaultLocationName).toBe("Sin ubicacion habitual");
  });

  it("assumes locations are supported when the business has no capabilities configured", async () => {
    const { service, getLocations } = setup({ capabilities: null });

    const page = await service.getApiAlerts(ALERT_PARAMS);

    expect(getLocations).toHaveBeenCalledTimes(1);
    expect(firstAlertRow(page).defaultLocationName).toBe("Pasillo A");
  });

  it("reuses cached locations, but asks again after the capability was turned off and on", async () => {
    const { service, getCapabilities, getLocations } = setup();

    await service.getApiAlerts(ALERT_PARAMS);
    await service.getApiAlerts(ALERT_PARAMS);
    expect(getLocations).toHaveBeenCalledTimes(1);

    getCapabilities.mockResolvedValueOnce({ supportsMultipleLocations: false });
    await service.getApiAlerts(ALERT_PARAMS);
    await service.getApiAlerts(ALERT_PARAMS);

    expect(getLocations).toHaveBeenCalledTimes(2);
  });

  it("returns an empty page without reading the API while the stock source is mock", async () => {
    const { service, getInventoryAlertPage } = setup({ stockSource: "mock" });

    const page = await service.getApiAlerts(ALERT_PARAMS);

    expect(page.items).toEqual([]);
    expect(getInventoryAlertPage).not.toHaveBeenCalled();
  });
});

describe("GetInventoryAlertsService API product row", () => {
  const ROW_PARAMS = { ...ALERT_PARAMS, productId: PRODUCT_ID };

  it("maps the operational balance and leaves physical and unlocated quantities unknown", async () => {
    const { service, getStockPage } = setup();

    const row = await service.getApiProductRow(ROW_PARAMS);

    expect(getStockPage).toHaveBeenCalledWith(expect.objectContaining({ branchId: BRANCH_ID, search: "TAL-001" }));
    expect(row).toEqual(
      expect.objectContaining({
        productId: PRODUCT_ID,
        defaultLocationId: "loc-a",
        defaultLocationName: "Pasillo A",
        operationalQuantity: 2,
        operationalReservedQuantity: 1,
        operationalAvailableQuantity: 1,
        unlocatedQuantity: null,
        physicalQuantity: null,
        requiresRegularization: null,
      }),
    );
  });

  it("uses the neutral label when the backend sends no location name", async () => {
    const { service } = setup({
      stockItems: [stockItem({ defaultLocationId: null, defaultLocationName: null })],
    });

    const row = await service.getApiProductRow(ROW_PARAMS);

    expect(row?.defaultLocationName).toBe("Sin ubicacion habitual");
  });

  it("returns null while the stock source is mock", async () => {
    const { service, getStockPage } = setup({ stockSource: "mock" });

    await expect(service.getApiProductRow(ROW_PARAMS)).resolves.toBeNull();
    expect(getStockPage).not.toHaveBeenCalled();
  });

  it("returns null for a product of another tenant without reading its stock", async () => {
    const { service, getStockPage } = setup({ productTenantId: "tenant-other" });

    await expect(service.getApiProductRow(ROW_PARAMS)).resolves.toBeNull();
    expect(getStockPage).not.toHaveBeenCalled();
  });

  it("returns null when the stock page does not include the product", async () => {
    const { service } = setup({ stockItems: [stockItem({ productId: "product-other" })] });

    await expect(service.getApiProductRow(ROW_PARAMS)).resolves.toBeNull();
  });
});

describe("GetInventoryAlertsService API stock page", () => {
  it("returns the branch locations and the capability flag with the rows", async () => {
    const { service } = setup();

    const result = await service.execute({
      branchId: BRANCH_ID,
      branchName: "Central",
      page: 1,
      pageSize: 20,
    });

    expect(result.supportsMultipleLocations).toBe(true);
    expect(result.locations.map((item) => item.id)).toEqual(["loc-a"]);
    expect(result.rows[0].defaultLocationName).toBe("Pasillo A");
  });

  it("sends the page without locations when the capability is off", async () => {
    const { service, getLocations } = setup({ capabilities: { supportsMultipleLocations: false } });

    const result = await service.execute({
      branchId: BRANCH_ID,
      branchName: "Central",
      page: 1,
      pageSize: 20,
    });

    expect(getLocations).not.toHaveBeenCalled();
    expect(result.supportsMultipleLocations).toBe(false);
    expect(result.locations).toEqual([]);
  });
});
