import { describe, expect, it } from "vitest";
import type { InventoryBalance, StorageLocation } from "@/core/entities";
import { LocationStatus } from "@/core/enums";
import { getCanonicalKitAvailability, getCanonicalProductAvailability } from "@/core/inventory/canonicalAvailability";
import {
  findAssignedLocationId,
  getBranchAvailableQuantity,
  InsufficientInventoryAvailabilityError,
  planInventoryAllocation,
  resolveOperationalLocation,
  selectOperationalBalances,
} from "@/core/inventory/stockAvailability";
import type { Product } from "@/core/entities";

const tenantId = "tenant-1";
const branchId = "branch-1";
const productId = "product-1";
const NOW = "2026-01-01T00:00:00.000Z";

function location(id: string, status = LocationStatus.active): StorageLocation {
  return {
    id,
    tenantId,
    branchId,
    code: id.toUpperCase(),
    name: `Ubicacion ${id}`,
    type: "shelf",
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function balance(
  id: string,
  locationId: string | undefined,
  quantity: number,
  reservedQuantity = 0,
  overrides: Partial<InventoryBalance> = {},
): InventoryBalance {
  return {
    id,
    tenantId,
    branchId,
    productId,
    locationId,
    quantity,
    reservedQuantity,
    updatedAt: NOW,
    ...overrides,
  };
}

const locations = [location("a"), location("b")];

function scope(balances: InventoryBalance[], assignedLocationId: string | null, extra = {}) {
  return { tenantId, branchId, productId, balances, locations, assignedLocationId, ...extra };
}

describe("operational location policy", () => {
  it("has zero commercial availability when the assigned location A is empty but B has stock", () => {
    const balances = [balance("bal-a", "a", 0), balance("bal-b", "b", 10)];

    expect(getBranchAvailableQuantity(scope(balances, "a"))).toBe(0);
    expect(selectOperationalBalances(scope(balances, "a")).map((item) => item.id)).toEqual(["bal-a"]);
  });

  it("rejects a sale or reservation bigger than the balance of A without consuming B", () => {
    const balances = [balance("bal-a", "a", 2), balance("bal-b", "b", 10)];
    const snapshot = structuredClone(balances);

    expect(() => planInventoryAllocation({ ...scope(balances, "a"), quantity: 3 })).toThrow(
      InsufficientInventoryAvailabilityError,
    );
    expect(balances).toEqual(snapshot);
  });

  it("plans the allocation only on the assigned location", () => {
    const balances = [balance("bal-a", "a", 5, 1), balance("bal-b", "b", 10)];

    const allocations = planInventoryAllocation({ ...scope(balances, "a"), quantity: 4 });

    expect(allocations).toEqual([
      expect.objectContaining({ balanceId: "bal-a", locationId: "a", quantity: 4, quantityAfter: 1 }),
    ]);
  });

  it("does not mix an additional NULL balance with assigned stock", () => {
    const balances = [balance("bal-a", "a", 2), balance("bal-null", undefined, 50)];

    expect(getBranchAvailableQuantity(scope(balances, "a"))).toBe(2);
    expect(() => planInventoryAllocation({ ...scope(balances, "a"), quantity: 3 })).toThrow(
      InsufficientInventoryAvailabilityError,
    );
  });

  it("only uses legacy NULL balances when the product has no assignment", () => {
    const balances = [balance("bal-a", "a", 7), balance("bal-null", undefined, 3)];

    expect(resolveOperationalLocation(scope(balances, null))).toEqual({ source: "legacy_null" });
    expect(getBranchAvailableQuantity(scope(balances, null))).toBe(3);
  });

  it("does not let a new product without assignment operate located stock", () => {
    const balances = [balance("bal-a", "a", 7)];

    expect(getBranchAvailableQuantity(scope(balances, null))).toBe(0);
    expect(() => planInventoryAllocation({ ...scope(balances, null), quantity: 1 })).toThrow(
      InsufficientInventoryAvailabilityError,
    );
  });

  it("rejects an inactive or unknown assigned location instead of falling back", () => {
    const balances = [balance("bal-a", "a", 9), balance("bal-b", "b", 9)];
    const inactive = scope(balances, "a", { locations: [location("a", LocationStatus.inactive), location("b")] });

    expect(resolveOperationalLocation(inactive)).toEqual({ source: "none", reason: "location_inactive" });
    expect(getBranchAvailableQuantity(inactive)).toBe(0);
    expect(resolveOperationalLocation(scope(balances, "missing"))).toEqual({
      source: "none",
      reason: "location_unknown",
    });
    expect(() => planInventoryAllocation({ ...inactive, quantity: 1 })).toThrow();
  });

  it("ignores balances of other tenants, branches and products", () => {
    const balances = [
      balance("own", "a", 1),
      balance("other-tenant", "a", 9, 0, { tenantId: "tenant-2" }),
      balance("other-branch", "a", 9, 0, { branchId: "branch-2" }),
      balance("other-product", "a", 9, 0, { productId: "product-2" }),
    ];

    expect(getBranchAvailableQuantity(scope(balances, "a"))).toBe(1);
  });

  it("finds the assigned location per branch and product from the settings", () => {
    const settings = [
      { tenantId, branchId, productId, defaultLocationId: "a" },
      { tenantId, branchId: "branch-2", productId, defaultLocationId: "z" },
      { tenantId, branchId, productId: "product-2", defaultLocationId: undefined },
    ];

    expect(findAssignedLocationId(settings, { tenantId, branchId, productId })).toBe("a");
    expect(findAssignedLocationId(settings, { tenantId, branchId, productId: "product-2" })).toBeNull();
    expect(findAssignedLocationId(settings, { tenantId, branchId, productId: "none" })).toBeNull();
  });
});

describe("kit availability from the operational stock of components", () => {
  const componentA = { componentProductId: "comp-a", quantityPerKit: 2 };
  const componentB = { componentProductId: "comp-b", quantityPerKit: 1 };

  function product(id: string): Product {
    return {
      id,
      tenantId,
      tracking: { stock: true, lot: false, expiration: false, serial: false },
    } as Product;
  }

  function availability(id: string, balances: InventoryBalance[], assigned: string | null) {
    return getCanonicalProductAvailability({
      product: product(id),
      tenantId,
      branchId,
      balances,
      lots: [],
      serials: [],
      locations,
      assignedLocationId: assigned,
      at: NOW,
    });
  }

  it("counts only the assigned location of every component", () => {
    const aBalances = [
      balance("a-ok", "a", 9, 1, { productId: "comp-a" }),
      balance("a-other", "b", 100, 0, { productId: "comp-a" }),
    ];
    const bBalances = [balance("b-ok", "a", 5, 0, { productId: "comp-b" })];

    const componentAvailability = new Map([
      ["comp-a", availability("comp-a", aBalances, "a")],
      ["comp-b", availability("comp-b", bBalances, "a")],
    ]);

    expect(componentAvailability.get("comp-a")).toBe(8);
    expect(
      getCanonicalKitAvailability({ components: [componentA, componentB], componentAvailability }),
    ).toBe(4);
  });

  it("makes the kit unavailable when a component has no operational stock", () => {
    const stockElsewhereOnly = [balance("only-b", "b", 100, 0, { productId: "comp-a" })];
    const componentAvailability = new Map([
      ["comp-a", availability("comp-a", stockElsewhereOnly, "a")],
      ["comp-b", 50],
    ]);

    expect(
      getCanonicalKitAvailability({ components: [componentA, componentB], componentAvailability }),
    ).toBe(0);
  });
});
