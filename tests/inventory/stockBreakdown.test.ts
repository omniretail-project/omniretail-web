import { describe, expect, it, vi } from "vitest";
import { LocationStatus, RoleStatus, TenantStatus, UserStatus, UserType } from "@/core/enums";
import type { InventoryBalance, StorageLocation } from "@/core/entities";
import type { InventoryRepository } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { InventoryAdjustmentLookupService } from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";

const TENANT_ID = "tenant-1";
const BRANCH_ID = "branch-1";
const PRODUCT_ID = "product-1";
const NOW = "2026-01-01T00:00:00.000Z";

function location(id: string): StorageLocation {
  return {
    id,
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    code: id,
    name: id,
    type: "shelf",
    status: LocationStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function balance(
  id: string,
  locationId: string | undefined,
  quantity: number,
  reservedQuantity = 0,
): InventoryBalance {
  return {
    id,
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    productId: PRODUCT_ID,
    locationId,
    quantity,
    reservedQuantity,
    updatedAt: NOW,
  };
}

function createService(options: {
  balances: InventoryBalance[];
  assignedLocationId?: string;
  permissions?: string[];
}) {
  const user = {
    id: "user-1",
    tenantId: TENANT_ID,
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "role-1",
    allowedBranchIds: [BRANCH_ID],
  };
  const getProductBalances = vi.fn<InventoryRepository["getProductBalances"]>(
    async () => options.balances,
  );
  const getProductInventorySettings = vi.fn<InventoryRepository["getProductInventorySettings"]>(
    async () =>
      options.assignedLocationId
        ? {
            id: "settings-1",
            tenantId: TENANT_ID,
            branchId: BRANCH_ID,
            productId: PRODUCT_ID,
            minStock: 0,
            defaultLocationId: options.assignedLocationId,
            createdAt: NOW,
            updatedAt: NOW,
          }
        : null,
  );
  const getLocations = vi.fn<InventoryRepository["getLocations"]>(async () => [
    location("a"),
    location("b"),
  ]);
  const registry = {
    auth: {
      getCurrentSessionId: async () => "session-1",
      getSession: async () => ({ id: "session-1", userId: user.id }),
    },
    users: { getById: async () => user },
    tenants: { getById: async () => ({ id: TENANT_ID, status: TenantStatus.active }) },
    roles: {
      getByIdScoped: async () => ({
        id: "role-1",
        tenantId: TENANT_ID,
        status: RoleStatus.active,
        permissions: options.permissions ?? ["inventory.stock.read"],
      }),
    },
    inventory: { getProductBalances, getProductInventorySettings, getLocations },
  };
  return {
    service: new InventoryAdjustmentLookupService(registry as unknown as RepositoryRegistry),
    getProductBalances,
    getProductInventorySettings,
  };
}

const input = { branchId: BRANCH_ID, productId: PRODUCT_ID, usesLocations: true };

describe("getStockBreakdown", () => {
  it("separates physical, operational and legacy stock when it is held outside the assigned location", async () => {
    const { service } = createService({
      assignedLocationId: "a",
      balances: [balance("bal-a", "a", 10, 3), balance("bal-b", "b", 5), balance("bal-null", undefined, 2)],
    });

    await expect(service.getStockBreakdown(input)).resolves.toEqual({
      physicalQuantity: 17,
      operationalQuantity: 10,
      operationalReservedQuantity: 3,
      operationalAvailableQuantity: 7,
      legacyQuantity: 2,
      requiresRegularization: true,
    });
  });

  it("does not require regularization when everything is in the assigned location", async () => {
    const { service } = createService({
      assignedLocationId: "a",
      balances: [balance("bal-a", "a", 4, 1)],
    });

    await expect(service.getStockBreakdown(input)).resolves.toMatchObject({
      physicalQuantity: 4,
      operationalQuantity: 4,
      legacyQuantity: 0,
      requiresRegularization: false,
    });
  });

  it("treats the legacy NULL balance as operational only when there is no assignment", async () => {
    const { service } = createService({ balances: [balance("bal-null", undefined, 6, 2)] });

    await expect(service.getStockBreakdown(input)).resolves.toMatchObject({
      physicalQuantity: 6,
      operationalQuantity: 6,
      operationalReservedQuantity: 2,
      legacyQuantity: 6,
      requiresRegularization: false,
    });
  });

  it("requires stock read permission and reads the balances only once on demand", async () => {
    const denied = createService({ balances: [], permissions: [] });
    await expect(denied.service.getStockBreakdown(input)).rejects.toThrow();
    expect(denied.getProductBalances).not.toHaveBeenCalled();

    const allowed = createService({ balances: [balance("bal-null", undefined, 1)] });
    await allowed.service.getStockBreakdown(input);
    expect(allowed.getProductBalances).toHaveBeenCalledTimes(1);
    expect(allowed.getProductBalances).toHaveBeenCalledWith(PRODUCT_ID, BRANCH_ID, TENANT_ID);
  });

  it("ignores balances that belong to other tenants or branches", async () => {
    const foreign = { ...balance("foreign", "a", 99), tenantId: "tenant-2" };
    const { service } = createService({
      assignedLocationId: "a",
      balances: [balance("bal-a", "a", 2), foreign],
    });

    await expect(service.getStockBreakdown(input)).resolves.toMatchObject({ physicalQuantity: 2 });
  });
});
