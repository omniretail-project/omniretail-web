import { describe, expect, it, vi } from "vitest";
import type { Product, User } from "@/core/entities";
import {
  InventoryTransferReason,
  InventoryTransferStatus,
  PlanStatus,
  ProductStatus,
  ProductType,
  RoleStatus,
  SaasCapabilityKey,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { InventoryTransferWithItems } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ReceivingDocumentsService } from "@/modules/receiving/application/services/ReceivingDocumentsService";

const tenantId = "10000000-0000-4000-8000-000000000001";
const sourceBranchId = "10000000-0000-4000-8000-000000000002";
const destinationBranchId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const transferId = "10000000-0000-4000-8000-000000000005";
const transferItemId = "10000000-0000-4000-8000-000000000006";
const productId = "10000000-0000-4000-8000-000000000007";
const unitId = "10000000-0000-4000-8000-000000000008";
const now = "2026-10-14T12:00:00.000Z";

function emptyPage() {
  return { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 };
}

function createTransfer(): InventoryTransferWithItems {
  return {
    transfer: {
      id: transferId,
      tenantId,
      number: "TR-001",
      sourceBranchId,
      destinationBranchId,
      status: InventoryTransferStatus.inTransit,
      reason: InventoryTransferReason.replenishment,
      createdAt: now,
      updatedAt: now,
    },
    items: [
      {
        id: transferItemId,
        transferId,
        productId,
        requestedQuantity: 5,
        dispatchedQuantity: 5,
        receivedQuantity: 0,
      },
    ],
  };
}

function createProduct(): Product {
  return {
    id: productId,
    tenantId,
    sku: "MAR-001",
    name: "Martillo",
    productType: ProductType.physical,
    categoryId: "10000000-0000-4000-8000-000000000009",
    baseUnitId: unitId,
    salePrice: 25,
    status: ProductStatus.published,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    channels: { ecommerce: false, pos: false, mobileApp: false },
    createdAt: now,
    updatedAt: now,
  };
}

function createHarness() {
  const user: User = {
    id: userId,
    tenantId,
    name: "Mafer",
    email: "mafer@example.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "10000000-0000-4000-8000-000000000010",
    allowedBranchIds: [destinationBranchId],
    createdAt: now,
    updatedAt: now,
  };
  const inventoryTransfers = { query: vi.fn(async () => [createTransfer()]) };
  const repositories = {
    receivingDataSource: "api",
    inventoryTransfersDataSource: "api",
    auth: {
      getCurrentSessionId: vi.fn(async () => "session-1"),
      getSession: vi.fn(async () => ({
        id: "session-1",
        userId,
        activeBranchId: destinationBranchId,
      })),
    },
    users: { getById: vi.fn(async () => user) },
    roles: {
      getByIdScoped: vi.fn(async () => ({
        id: user.roleId,
        tenantId,
        status: RoleStatus.active,
        permissions: ["receiving.receipts.read"],
        branchScope: "selected",
      })),
    },
    tenants: { getById: vi.fn(async () => ({ id: tenantId, status: TenantStatus.active })) },
    tenantSubscriptions: {
      getByTenantId: vi.fn(async () => ({
        tenantId,
        planId: "plan-1",
        status: TenantSubscriptionStatus.active,
      })),
    },
    plans: {
      getById: vi.fn(async () => ({
        id: "plan-1",
        code: "plan-test",
        status: PlanStatus.active,
        capabilities: [SaasCapabilityKey.receiving],
        limits: {},
      })),
    },
    branches: {
      getById: vi.fn(async (id: string) => ({
        id,
        tenantId,
        name: id === sourceBranchId ? "Origen" : "Destino",
      })),
      getAll: vi.fn(async () => [
        { id: sourceBranchId, tenantId, name: "Origen" },
        { id: destinationBranchId, tenantId, name: "Destino" },
      ]),
    },
    purchaseOrders: { getPageScoped: vi.fn(async () => emptyPage()) },
    products: { getById: vi.fn(async () => createProduct()) },
    inventoryTransfers,
  } as unknown as RepositoryRegistry;
  return { service: new ReceivingDocumentsService(repositories), repositories, inventoryTransfers };
}

describe("ReceivingDocumentsService transfer API", () => {
  it("combines in-transit transfers with the purchase-order receiving queue", async () => {
    const { service, repositories, inventoryTransfers } = createHarness();

    const result = await service.execute(destinationBranchId);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      id: `transfer-${transferId}`,
      documentId: transferId,
      documentType: "transfer",
      documentNumber: "TR-001",
      supplierOrSource: "Origen",
    });
    expect(inventoryTransfers.query).toHaveBeenCalledWith({
      tenantId,
      destinationBranchId,
      status: InventoryTransferStatus.inTransit,
    });
    expect(repositories.purchaseOrders.getPageScoped).toHaveBeenCalledTimes(4);
  });
});
