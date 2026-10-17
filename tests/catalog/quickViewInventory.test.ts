import { describe, expect, it, vi } from "vitest";
import { LocationStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  loadQuickViewOperationalInventory,
  resolveQuickViewOperationalStock,
} from "@/modules/catalog/application/services/GetProductQuickViewService";

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const productId = "10000000-0000-4000-8000-000000000003";
const assignedLocationId = "10000000-0000-4000-8000-000000000004";
const otherLocationId = "10000000-0000-4000-8000-000000000005";

const balances = [
  {
    id: "balance-operational",
    tenantId,
    branchId,
    productId,
    locationId: assignedLocationId,
    quantity: 8,
    reservedQuantity: 3,
    updatedAt: "2026-10-09T00:00:00.000Z",
  },
  {
    id: "balance-other",
    tenantId,
    branchId,
    productId,
    locationId: otherLocationId,
    quantity: 100,
    reservedQuantity: 0,
    updatedAt: "2026-10-09T00:00:00.000Z",
  },
  {
    id: "balance-legacy",
    tenantId,
    branchId,
    productId,
    quantity: 4,
    reservedQuantity: 1,
    updatedAt: "2026-10-09T00:00:00.000Z",
  },
];

function assignedLocation(status = LocationStatus.active) {
  return {
    id: assignedLocationId,
    tenantId,
    branchId,
    code: "A-01",
    name: "Operativa",
    type: "warehouse" as const,
    status,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

describe("catalog quick view operational availability", () => {
  it("does not present stock from other locations as sellable", () => {
    expect(
      resolveQuickViewOperationalStock({
        balances,
        supportsMultipleLocations: true,
        defaultLocationId: assignedLocationId,
        defaultLocation: assignedLocation(),
      }),
    ).toMatchObject({
      locationId: assignedLocationId,
      legacyUnlocated: false,
      quantity: 8,
      reservedQuantity: 3,
      availableQuantity: 5,
    });
  });

  it("returns zero sellable stock for an inactive assignment", () => {
    expect(
      resolveQuickViewOperationalStock({
        balances,
        supportsMultipleLocations: true,
        defaultLocationId: assignedLocationId,
        defaultLocation: assignedLocation(LocationStatus.inactive),
      })?.availableQuantity,
    ).toBe(0);
  });

  it("uses only the legacy NULL balance when locations are disabled", () => {
    expect(
      resolveQuickViewOperationalStock({
        balances,
        supportsMultipleLocations: false,
        defaultLocationId: assignedLocationId,
      }),
    ).toMatchObject({
      locationId: null,
      legacyUnlocated: true,
      quantity: 4,
      reservedQuantity: 1,
      availableQuantity: 3,
    });
  });

  it("withholds sellable availability when an assigned location cannot be validated", () => {
    expect(
      resolveQuickViewOperationalStock({
        balances,
        supportsMultipleLocations: true,
        defaultLocationId: assignedLocationId,
      }),
    ).toBeNull();
  });

  it("does not invent a legacy operational balance when locations are enabled", () => {
    expect(
      resolveQuickViewOperationalStock({
        balances: balances.filter((balance) => balance.locationId),
        supportsMultipleLocations: true,
        defaultLocationId: null,
      }),
    ).toBeNull();
  });
});

describe("quick view operational reads", () => {
  function repositories() {
    return {
      inventory: {
        getProductBalances: vi.fn(async () => balances),
        getLocations: vi.fn(async () => [assignedLocation()]),
      },
    } as unknown as RepositoryRegistry;
  }

  it("loads one scoped balance request and reuses the location reference path", async () => {
    const registry = repositories();
    const result = await loadQuickViewOperationalInventory({
      repositories: registry,
      tenantId,
      branchId,
      productId,
      supportsMultipleLocations: true,
      defaultLocationId: assignedLocationId,
      canReadLocations: true,
    });

    expect(result.failed).toBe(false);
    expect(registry.inventory.getProductBalances).toHaveBeenCalledOnce();
    expect(registry.inventory.getProductBalances).toHaveBeenCalledWith(
      productId,
      branchId,
      tenantId,
    );
    expect(registry.inventory.getLocations).toHaveBeenCalledOnce();
  });

  it("skips balances and locations when an assigned location cannot be authorized", async () => {
    const registry = repositories();
    const result = await loadQuickViewOperationalInventory({
      repositories: registry,
      tenantId,
      branchId,
      productId,
      supportsMultipleLocations: true,
      defaultLocationId: assignedLocationId,
      canReadLocations: false,
    });

    expect(result).toMatchObject({ failed: false, balances: [], defaultLocation: undefined });
    expect(registry.inventory.getProductBalances).not.toHaveBeenCalled();
    expect(registry.inventory.getLocations).not.toHaveBeenCalled();
  });

  it("degrades only operational stock when its optional balance read fails", async () => {
    const registry = repositories();
    vi.mocked(registry.inventory.getProductBalances).mockRejectedValueOnce(new Error("offline"));

    await expect(
      loadQuickViewOperationalInventory({
        repositories: registry,
        tenantId,
        branchId,
        productId,
        supportsMultipleLocations: false,
        defaultLocationId: null,
        canReadLocations: true,
      }),
    ).resolves.toMatchObject({ failed: true, balances: [] });
  });
});
