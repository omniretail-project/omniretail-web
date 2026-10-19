import { describe, expect, it, vi } from "vitest";
import {
  InventoryMovementType,
  InventoryTransferStatus,
  RoleStatus,
  TenantStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { InventoryMovementListItem, InventoryMovementPageResult, InventoryRepository } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  GetInventoryTransferHistoryService,
  TRANSFER_HISTORY_MOVEMENT_MAX_PAGES,
} from "@/modules/inventory/application/services/GetInventoryTransferHistoryService";

const TENANT_ID = "tenant-1";
const SOURCE_ID = "branch-source";
const DESTINATION_ID = "branch-destination";
const TRANSFER_ID = "transfer-1";
const NOW = "2026-02-01T10:00:00.000Z";

function pageItem(overrides: Partial<InventoryMovementListItem> = {}): InventoryMovementListItem {
  return {
    id: "movement-1",
    tenantId: TENANT_ID,
    branchId: SOURCE_ID,
    branchName: "Sucursal origen",
    productId: "product-1",
    productName: "Producto 1",
    sku: "SKU-1",
    type: InventoryMovementType.out,
    displayType: "transfer",
    reason: "Despacho del traslado",
    quantity: 3,
    quantityBefore: 10,
    quantityAfter: 7,
    fromLocationId: null,
    fromLocationName: null,
    toLocationId: null,
    toLocationName: null,
    referenceType: "INVENTORY_TRANSFER",
    referenceId: TRANSFER_ID,
    referenceLabel: null,
    performedByUserId: null,
    userLabel: null,
    createdAt: NOW,
    ...overrides,
  };
}

function page(
  items: InventoryMovementListItem[],
  pageNumber: number,
  totalPages: number,
): InventoryMovementPageResult {
  return {
    items,
    page: pageNumber,
    pageSize: 100,
    totalItems: items.length,
    totalPages,
    summary: { incoming: 0, outgoing: 0, net: 0 },
  };
}

function createRegistry(dataSource: "api" | "mock") {
  const getMovementPage = vi.fn<InventoryRepository["getMovementPage"]>(async () => page([], 1, 1));
  const getMovements = vi.fn<InventoryRepository["getMovements"]>(async () => []);
  const user = {
    id: "user-1",
    tenantId: TENANT_ID,
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "role-1",
    allowedBranchIds: [SOURCE_ID],
  };
  const registry = {
    inventoryMovementsDataSource: dataSource,
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
        permissions: ["inventory.stock.read"],
      }),
    },
    branches: {
      getById: async (id: string) => ({ id, tenantId: TENANT_ID, name: id }),
      getAll: async () => [
        { id: SOURCE_ID, tenantId: TENANT_ID, name: "Sucursal origen" },
        { id: DESTINATION_ID, tenantId: TENANT_ID, name: "Sucursal destino" },
      ],
    },
    inventoryTransfers: {
      query: async (filters?: { sourceBranchId?: string }) =>
        filters?.sourceBranchId
          ? [
              {
                transfer: {
                  id: TRANSFER_ID,
                  tenantId: TENANT_ID,
                  number: "TR-001",
                  sourceBranchId: SOURCE_ID,
                  destinationBranchId: DESTINATION_ID,
                  status: InventoryTransferStatus.preparing,
                  sourceRequestIds: [],
                  createdAt: NOW,
                  updatedAt: NOW,
                },
                items: [{ id: "item-1", productId: "product-1", requestedQuantity: 3 }],
              },
            ]
          : [],
    },
    dispatches: { getAll: async () => [] },
    picking: { getBySource: async () => null },
    packings: { getBySource: async () => null },
    inventory: { getMovementPage, getMovements },
  };
  return {
    service: new GetInventoryTransferHistoryService(registry as unknown as RepositoryRegistry),
    getMovementPage,
    getMovements,
  };
}

describe("GetInventoryTransferHistoryService movements", () => {
  it("never reads movements from the mock store in API mode", async () => {
    const { service, getMovementPage, getMovements } = createRegistry("api");
    getMovementPage.mockResolvedValue(page([pageItem()], 1, 1));

    const rows = await service.execute(SOURCE_ID, "product-1");

    expect(getMovements).not.toHaveBeenCalled();
    expect(getMovementPage).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: SOURCE_ID, productId: "product-1", page: 1 }),
    );
    expect(rows[0].movements).toEqual([
      expect.objectContaining({ id: "movement-1", label: "Transfer Out", quantity: 3 }),
    ]);
  });

  it("links movements only through the transfer identity and ignores unrelated ones", async () => {
    const { service, getMovementPage } = createRegistry("api");
    getMovementPage.mockResolvedValue(
      page(
        [
          pageItem({ id: "own" }),
          pageItem({ id: "other-transfer", referenceId: "transfer-other" }),
          pageItem({ id: "sale", referenceId: TRANSFER_ID, type: InventoryMovementType.adjustment }),
        ],
        1,
        1,
      ),
    );

    const rows = await service.execute(SOURCE_ID);

    expect(rows[0].movements.map((movement) => movement.id)).toEqual(["own"]);
  });

  it("states the branch-only limitation explicitly instead of simulating the counterpart", async () => {
    const { service } = createRegistry("api");

    const rows = await service.execute(SOURCE_ID);

    expect(rows[0].movementsLimitation).toContain("Solo se muestran los movimientos de esta sucursal");
    expect(rows[0].movementsLimitation).not.toContain("parcial");
  });

  it("follows the server pagination and reports a partial history past the page cap", async () => {
    const complete = createRegistry("api");
    complete.getMovementPage
      .mockResolvedValueOnce(page([pageItem({ id: "m1" })], 1, 2))
      .mockResolvedValueOnce(page([pageItem({ id: "m2", type: InventoryMovementType.in })], 2, 2));

    const rows = await complete.service.execute(SOURCE_ID);

    expect(complete.getMovementPage).toHaveBeenCalledTimes(2);
    expect(rows[0].movements.map((movement) => movement.id)).toEqual(["m1", "m2"]);
    expect(rows[0].movementsLimitation).not.toContain("parcial");

    const capped = createRegistry("api");
    capped.getMovementPage.mockImplementation(async (params) =>
      page([pageItem({ id: `m${params.page}` })], params.page, 50),
    );

    const cappedRows = await capped.service.execute(SOURCE_ID);

    expect(capped.getMovementPage).toHaveBeenCalledTimes(TRANSFER_HISTORY_MOVEMENT_MAX_PAGES);
    expect(cappedRows[0].movementsLimitation).toContain("parcial");
  });

  it("keeps the independent mock behaviour reading the local store", async () => {
    const { service, getMovementPage, getMovements } = createRegistry("mock");
    getMovements.mockResolvedValue([
      {
        id: "local-1",
        tenantId: TENANT_ID,
        branchId: SOURCE_ID,
        productId: "product-1",
        type: InventoryMovementType.out,
        reason: "Salida local",
        quantity: 2,
        referenceType: "transfer",
        referenceId: TRANSFER_ID,
        createdAt: NOW,
      },
    ]);

    const rows = await service.execute(SOURCE_ID);

    expect(getMovementPage).not.toHaveBeenCalled();
    expect(rows[0].movements).toEqual([expect.objectContaining({ id: "local-1" })]);
    expect(rows[0].movementsLimitation).toBeUndefined();
  });
});
