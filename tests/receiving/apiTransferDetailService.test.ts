import { describe, expect, it, vi } from "vitest";
import type { Product, StorageLocation, User } from "@/core/entities";
import {
  InventoryTransferReason,
  InventoryTransferStatus,
  LocationStatus,
  PlanStatus,
  ProductStatus,
  ProductType,
  ReceiptStatus,
  RoleStatus,
  SaasCapabilityKey,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { InventoryTransferWithItems } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ReceivingDocumentDetailService } from "@/modules/receiving/application/services/ReceivingDocumentDetailService";

const tenantId = "10000000-0000-4000-8000-000000000001";
const sourceBranchId = "10000000-0000-4000-8000-000000000002";
const destinationBranchId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const transferId = "10000000-0000-4000-8000-000000000005";
const transferItemId = "10000000-0000-4000-8000-000000000006";
const productId = "10000000-0000-4000-8000-000000000007";
const locationId = "10000000-0000-4000-8000-000000000008";
const unitId = "10000000-0000-4000-8000-000000000009";
const now = "2026-10-14T12:00:00.000Z";

function createTransfer(status = InventoryTransferStatus.inTransit): InventoryTransferWithItems {
  return {
    transfer: {
      id: transferId,
      tenantId,
      number: "TR-001",
      sourceBranchId,
      destinationBranchId,
      status,
      reason: InventoryTransferReason.replenishment,
      createdAt: now,
      updatedAt: now,
    },
    items: [
      {
        id: transferItemId,
        transferId,
        productId,
        requestedQuantity: 4,
        dispatchedQuantity: 4,
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
    categoryId: "10000000-0000-4000-8000-000000000010",
    baseUnitId: unitId,
    salePrice: 25,
    status: ProductStatus.published,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    channels: { ecommerce: false, pos: false, mobileApp: false },
    createdAt: now,
    updatedAt: now,
  };
}

function createLocation(): StorageLocation {
  return {
    id: locationId,
    tenantId,
    branchId: destinationBranchId,
    code: "A-01",
    name: "Estante A",
    type: "shelf",
    status: LocationStatus.active,
    createdAt: now,
    updatedAt: now,
  };
}

function createHarness(
  options: { permissions?: string[]; transferStatus?: InventoryTransferStatus } = {},
) {
  const user: User = {
    id: userId,
    tenantId,
    name: "Mafer",
    email: "mafer@example.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "10000000-0000-4000-8000-000000000011",
    allowedBranchIds: [destinationBranchId],
    createdAt: now,
    updatedAt: now,
  };
  const transfer = createTransfer(options.transferStatus);
  const inventoryTransfers = {
    getById: vi.fn(async () => transfer),
    markReceived: vi.fn(async () => ({
      ...transfer,
      transfer: {
        ...transfer.transfer,
        status: InventoryTransferStatus.received,
        receivedByUserId: userId,
        receivedAt: now,
      },
    })),
  };
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
        permissions: options.permissions ?? [
          "receiving.receipts.read",
          "receiving.receipts.confirm",
          "inventory.transfers.manage",
        ],
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
    products: { getByIdScoped: vi.fn(async () => createProduct()) },
    units: {
      getAll: vi.fn(async () => [{ id: unitId, tenantId, name: "Unidad", allowsDecimals: false }]),
    },
    businessConfig: {
      getCapabilities: vi.fn(async () => ({
        tenantId,
        supportsInventory: true,
        supportsLots: true,
        supportsExpiration: true,
        supportsSerials: true,
        supportsMultipleLocations: true,
        supportsUnitsAndPackaging: true,
      })),
    },
    inventory: {
      getLocations: vi.fn(async () => [createLocation()]),
      getProductInventorySettings: vi.fn(async () => ({
        id: "10000000-0000-4000-8000-000000000012",
        tenantId,
        branchId: destinationBranchId,
        productId,
        minStock: 0,
        defaultLocationId: locationId,
        createdAt: now,
        updatedAt: now,
      })),
    },
    inventoryTransfers,
  } as unknown as RepositoryRegistry;
  return {
    service: new ReceivingDocumentDetailService(repositories),
    repositories,
    inventoryTransfers,
  };
}

describe("ReceivingDocumentDetailService transfer API", () => {
  it("uses the backend transfer and real operational location to build a confirmable detail", async () => {
    const { service, repositories } = createHarness();

    const detail = await service.getDocument("transfer", transferId, destinationBranchId);

    expect(detail.dataSource).toBe("api");
    expect(detail.transferReception).toMatchObject({
      canConfirmTransfer: true,
      destinationLocationId: locationId,
      requiresSingleDestinationLocation: true,
    });
    expect(detail.lines[0]).toMatchObject({ sourceLineId: transferItemId, locationId });
    expect(repositories.inventory.getProductInventorySettings).toHaveBeenCalledWith(
      productId,
      destinationBranchId,
    );
  });

  it("confirms a partial non-traceable transfer with the resolved location and preserves its idempotency key", async () => {
    const { service, inventoryTransfers } = createHarness();
    const detail = await service.getDocument("transfer", transferId, destinationBranchId);

    const receipt = await service.confirm({
      documentType: "transfer",
      documentId: transferId,
      confirmationId: "transfer-confirmation-1",
      lines: [{ ...detail.lines[0], locationId: "client-manipulated-location", receivedNow: 2 }],
      incidents: [],
    });

    expect(inventoryTransfers.markReceived).toHaveBeenCalledWith(
      transferId,
      expect.objectContaining({
        confirmationId: "transfer-confirmation-1",
        items: [{ itemId: transferItemId, receivedQuantity: 2, locationId }],
      }),
    );
    expect(receipt.status).toBe(ReceiptStatus.received);
  });

  it("confirms the total pending quantity using the same resolved location", async () => {
    const { service, inventoryTransfers } = createHarness();
    const detail = await service.getDocument("transfer", transferId, destinationBranchId);

    await service.confirm({
      documentType: "transfer",
      documentId: transferId,
      confirmationId: "transfer-confirmation-total",
      lines: [{ ...detail.lines[0], receivedNow: 4 }],
      incidents: [],
    });

    expect(inventoryTransfers.markReceived).toHaveBeenCalledWith(
      transferId,
      expect.objectContaining({
        confirmationId: "transfer-confirmation-total",
        items: [{ itemId: transferItemId, receivedQuantity: 4, locationId }],
      }),
    );
  });

  it("blocks confirmation in the detail read model when the user lacks transfer permissions", async () => {
    const { service } = createHarness({ permissions: ["receiving.receipts.read"] });

    const detail = await service.getDocument("transfer", transferId, destinationBranchId);

    expect(detail.transferReception).toMatchObject({
      canConfirmTransfer: false,
      blockingReason: "No dispone de permisos para confirmar traslados.",
    });
  });

  it("blocks a transfer that is no longer in transit", async () => {
    const { service } = createHarness({ transferStatus: InventoryTransferStatus.received });

    const detail = await service.getDocument("transfer", transferId, destinationBranchId);

    expect(detail.transferReception).toMatchObject({
      canConfirmTransfer: false,
      blockingReason: expect.stringMatching(/debe estar en tránsito/i),
    });
  });

  it("rejects a transfer that does not exist and one opened from a different active branch", async () => {
    const missing = createHarness();
    const getTransferById = missing.inventoryTransfers.getById as unknown as ReturnType<
      typeof vi.fn
    >;
    getTransferById.mockResolvedValueOnce(null);

    await expect(
      missing.service.getDocument("transfer", transferId, destinationBranchId),
    ).rejects.toThrow("Traslado no encontrado.");

    const wrongBranch = createHarness();
    await expect(
      wrongBranch.service.getDocument(
        "transfer",
        transferId,
        "10000000-0000-4000-8000-000000000099",
      ),
    ).rejects.toThrow("El traslado no pertenece a la sucursal activa.");
  });

  it("blocks confirmation when the product lacks an active operational location", async () => {
    const { service, repositories } = createHarness();
    const getProductInventorySettings = repositories.inventory
      .getProductInventorySettings as unknown as ReturnType<typeof vi.fn>;
    getProductInventorySettings.mockResolvedValueOnce(null);

    const detail = await service.getDocument("transfer", transferId, destinationBranchId);

    expect(detail.transferReception).toMatchObject({
      canConfirmTransfer: false,
      blockedLineIds: [transferItemId],
      blockingReason: expect.stringMatching(/ubicación operativa activa/i),
    });
  });

  it("rejects quantities above the canonical pending amount", async () => {
    const { service } = createHarness();
    const detail = await service.getDocument("transfer", transferId, destinationBranchId);

    await expect(
      service.confirm({
        documentType: "transfer",
        documentId: transferId,
        confirmationId: "transfer-confirmation-too-many",
        lines: [{ ...detail.lines[0], receivedNow: 5 }],
        incidents: [],
      }),
    ).rejects.toThrow(/excede lo pendiente/i);
  });

  it("requires an idempotency key and at least one received quantity", async () => {
    const { service } = createHarness();
    const detail = await service.getDocument("transfer", transferId, destinationBranchId);

    await expect(
      service.confirm({
        documentType: "transfer",
        documentId: transferId,
        confirmationId: " ",
        lines: [{ ...detail.lines[0], receivedNow: 1 }],
        incidents: [],
      }),
    ).rejects.toThrow(/requiere una identidad/i);

    await expect(
      service.confirm({
        documentType: "transfer",
        documentId: transferId,
        confirmationId: "transfer-confirmation-empty",
        lines: [{ ...detail.lines[0], receivedNow: 0 }],
        incidents: [],
      }),
    ).rejects.toThrow(/al menos una cantidad/i);
  });
});
