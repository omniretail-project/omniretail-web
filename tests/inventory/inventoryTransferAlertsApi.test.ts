import { describe, expect, it, vi } from "vitest";
import type { Branch, InventoryTransferRequest, Product, Role, User } from "@/core/entities";
import {
  BranchStatus,
  BranchType,
  InventoryTransferReason,
  InventoryTransferRequestStatus,
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
const SOURCE_BRANCH_ID = "branch-source";
const REQUESTING_BRANCH_ID = "branch-requesting";
const PRODUCT_ID = "product-1";
const NOW = "2026-10-13T12:00:00.000Z";
const RECENT = new Date().toISOString();

describe("GetInventoryAlertsService API transfer requests", () => {
  it("maps pending received requests and recent authoritative responses", async () => {
    const incoming = request({
      id: "request-incoming",
      status: InventoryTransferRequestStatus.requested,
    });
    const approved = request({
      id: "request-approved",
      status: InventoryTransferRequestStatus.approved,
      approvedAt: RECENT,
      reviewedAt: RECENT,
    });
    const oldRejected = request({
      id: "request-old",
      status: InventoryTransferRequestStatus.rejected,
      rejectedAt: "2020-01-01T00:00:00.000Z",
      reviewedAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const getRequests = vi.fn(async ({ sourceBranchId, requestingBranchId }) =>
      sourceBranchId ? [incoming] : requestingBranchId ? [approved, oldRejected] : [],
    );
    const getStockBatch = vi.fn(async () => ({
      branchId: SOURCE_BRANCH_ID,
      items: [
        {
          productId: PRODUCT_ID,
          quantity: 12,
          reservedQuantity: 4,
          availableQuantity: 8,
          minStock: 2,
          reorderPoint: 4,
          status: "normal" as const,
          suggestedReorder: 0,
        },
      ],
    }));
    const service = new GetInventoryAlertsService(
      repositories({ getRequests, getStockBatch }) as unknown as RepositoryRegistry,
    );

    const rows = await service.getApiTransferRequests({
      branchId: SOURCE_BRANCH_ID,
      branchName: "Bodega Central",
    });

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: incoming.id,
          context: "received",
          productName: "Taladro",
          sourceBranchName: "Bodega Central",
          requestingBranchName: "Sucursal Norte",
          availableQuantity: 8,
        }),
        expect.objectContaining({
          id: approved.id,
          context: "response",
          status: InventoryTransferRequestStatus.approved,
        }),
      ]),
    );
    expect(rows.find((row) => row.id === approved.id)).not.toHaveProperty("availableQuantity");
    expect(rows.some((row) => row.id === oldRejected.id)).toBe(false);
    expect(getRequests).toHaveBeenCalledTimes(2);
    expect(getStockBatch).toHaveBeenCalledWith({
      branchId: SOURCE_BRANCH_ID,
      productIds: [PRODUCT_ID],
    });
  });

  it("does not read transfer requests from API while the transfer data source is mock", async () => {
    const getRequests = vi.fn();
    const service = new GetInventoryAlertsService(
      repositories({
        getRequests,
        inventoryTransfersDataSource: "mock",
      }) as unknown as RepositoryRegistry,
    );

    await expect(
      service.getApiTransferRequests({ branchId: SOURCE_BRANCH_ID, branchName: "Central" }),
    ).resolves.toEqual([]);
    expect(getRequests).not.toHaveBeenCalled();
  });

  it("includes API transfer requests when execute loads the active branch page", async () => {
    const incoming = request({
      id: "request-through-execute",
      status: InventoryTransferRequestStatus.requested,
    });
    const getRequests = vi.fn(async ({ sourceBranchId }) =>
      sourceBranchId ? [incoming] : [],
    );
    const getStockBatch = vi.fn(async () => ({
      branchId: SOURCE_BRANCH_ID,
      items: [
        {
          productId: PRODUCT_ID,
          quantity: 12,
          reservedQuantity: 4,
          availableQuantity: 8,
          minStock: 2,
          reorderPoint: 4,
          status: "normal" as const,
          suggestedReorder: 0,
        },
      ],
    }));
    const getStockPage = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
      summary: { activeProducts: 0, lowStock: 0, outOfStock: 0 },
    }));
    const service = new GetInventoryAlertsService(
      repositories({ getRequests, getStockBatch, getStockPage }) as unknown as RepositoryRegistry,
    );

    const result = await service.execute({
      branchId: SOURCE_BRANCH_ID,
      branchName: "Bodega Central",
      page: 1,
      pageSize: 20,
    });

    expect(result.transferRequests).toEqual([
      expect.objectContaining({
        id: incoming.id,
        context: "received",
        sourceBranchId: SOURCE_BRANCH_ID,
        availableQuantity: 8,
      }),
    ]);
    expect(getStockPage).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: SOURCE_BRANCH_ID,
        page: 1,
        pageSize: 20,
        productTypes: ["physical", "service", "kit"],
      }),
    );
    expect(getRequests).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      sourceBranchId: SOURCE_BRANCH_ID,
    });
    expect(getRequests).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      requestingBranchId: SOURCE_BRANCH_ID,
    });
  });
});

function repositories({
  getRequests,
  getStockBatch = vi.fn(),
  getStockPage = vi.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
    summary: { activeProducts: 0, lowStock: 0, outOfStock: 0 },
  })),
  inventoryTransfersDataSource = "api",
}: {
  getRequests: ReturnType<typeof vi.fn>;
  getStockBatch?: ReturnType<typeof vi.fn>;
  getStockPage?: ReturnType<typeof vi.fn>;
  inventoryTransfersDataSource?: "api" | "mock";
}) {
  const user: User = {
    id: "user-1",
    tenantId: TENANT_ID,
    name: "Ana",
    email: "ana@example.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "role-1",
    allowedBranchIds: [SOURCE_BRANCH_ID, REQUESTING_BRANCH_ID],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const role: Role = {
    id: "role-1",
    tenantId: TENANT_ID,
    name: "Inventario",
    isSystem: false,
    permissions: ["inventory.stock.read", "inventory.transfers.manage"],
    branchScope: "selected",
    status: RoleStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const branches: Branch[] = [
    branch(SOURCE_BRANCH_ID, "Bodega Central"),
    branch(REQUESTING_BRANCH_ID, "Sucursal Norte"),
  ];
  const product: Product = {
    id: PRODUCT_ID,
    tenantId: TENANT_ID,
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
  };
  return {
    inventoryStockDataSource: "api",
    inventoryTransfersDataSource,
    auth: {
      getCurrentSessionId: vi.fn(async () => "session-1"),
      getSession: vi.fn(async () => ({ id: "session-1", userId: user.id })),
    },
    users: { getById: vi.fn(async () => user) },
    roles: { getByIdScoped: vi.fn(async () => role) },
    tenants: {
      getById: vi.fn(async () => ({ id: TENANT_ID, status: TenantStatus.active })),
    },
    branches: {
      getById: vi.fn(async (id: string) => branches.find((item) => item.id === id) ?? null),
      getAll: vi.fn(async () => branches),
    },
    businessConfig: {
      getCapabilities: vi.fn(async () => ({ supportsMultipleLocations: false })),
    },
    categories: { getByTenant: vi.fn(async () => []) },
    units: { getByTenant: vi.fn(async () => []) },
    products: { getById: vi.fn(async (id: string) => (id === product.id ? product : null)) },
    inventoryTransferRequests: { getRequests },
    inventory: { getStockBatch, getStockPage },
  };
}

function branch(id: string, name: string): Branch {
  return {
    id,
    tenantId: TENANT_ID,
    code: id,
    name,
    type: BranchType.store,
    status: BranchStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function request(overrides: Partial<InventoryTransferRequest>): InventoryTransferRequest {
  return {
    id: "request-1",
    tenantId: TENANT_ID,
    requestingBranchId: REQUESTING_BRANCH_ID,
    sourceBranchId: SOURCE_BRANCH_ID,
    productId: PRODUCT_ID,
    requestedQuantity: 3,
    reason: InventoryTransferReason.replenishment,
    status: InventoryTransferRequestStatus.requested,
    requestedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
