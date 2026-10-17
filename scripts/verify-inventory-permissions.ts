import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BranchStatus,
  BranchType,
  BusinessPreset,
  InventoryTransferReason,
  PlanCode,
  PlanStatus,
  RoleStatus,
  SaasCapabilityKey,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
  ProductStatus,
  ProductType,
  UnitCategory,
  UnitStatus,
  LocationStatus,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockCategoryRepository,
  MockInventoryAdjustmentRepository,
  MockInventoryRepository,
  MockInventoryTransferRepository,
  MockInventoryTransferRequestRepository,
  MockPlanRepository,
  MockProductKitComponentRepository,
  MockPurchaseOrderRepository,
  MockReceiptRepository,
  MockDispatchRepository,
  MockOrderRepository,
  MockSalesRepository,
  MockProductRepository,
  MockRoleRepository,
  MockSupplierProductRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { GetInventoryAlertsService } from "@/modules/inventory/application/services/GetInventoryAlertsService";
import { GetInventoryMovementsService } from "@/modules/inventory/application/services/GetInventoryMovementsService";
import { RegisterInventoryAdjustmentService } from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import {
  ApproveTransferRequestService,
  CancelTransferRequestService,
  CreateTransferRequestService,
  RejectTransferRequestService,
} from "@/modules/inventory/application/services/TransferRequestServices";

const TENANT_A = "tenant-demo";
const TENANT_B = "tenant-inventory-hardening-b";
const BRANCH_CENTRO = "branch-centro";
const BRANCH_NORTE = "branch-norte";
const BRANCH_B = "branch-inventory-hardening-b";
const PRODUCT_SCREWS = "prod-screws";
const PRODUCT_HAMMER = "prod-hammer";
const PRODUCT_B = "product-inventory-hardening-b";
const LOCATION_CENTRO = "loc-centro-a";
const LOCATION_NORTE = "loc-norte-a";
const LOCATION_B = "loc-inventory-hardening-b";
const NOW = "2026-09-15T12:00:00.000Z";

/**
 * feature/saas-entitlement-enforcement agregó un guard de entitlement SaaS delante de las
 * mutaciones de Inventory -- este harness prueba permisos/tenant/branch, no entitlements (eso
 * vive en verify-saas-entitlement-enforcement.ts), así que TENANT_B necesita un Plan "full" para
 * no quedar bloqueado por una capa que este script no está probando.
 */
function seedFullEntitlementPlan(db: MockDatabase, tenantId: string) {
  const planId = `plan-full-${tenantId}`;
  db.planDefinitions.push({
    id: planId,
    code: PlanCode.enterprise,
    name: `Plan full (fixture ${tenantId})`,
    status: PlanStatus.active,
    capabilities: Object.values(SaasCapabilityKey),
    limits: {},
    createdAt: NOW,
    updatedAt: NOW,
  });
  db.tenantSubscriptions.push({
    id: `tenant-subscription-${tenantId}`,
    tenantId,
    planId,
    status: TenantSubscriptionStatus.active,
    startedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

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

interface Session {
  id: string;
  userId: string;
  activeBranchId?: string;
}

function createHarness() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    db.tenants.push({
      id: TENANT_B,
      name: "Inventory Hardening Tenant B",
      slug: "inventory-hardening-b",
      status: TenantStatus.active,
      defaultCurrency: "GTQ",
      timezone: "America/Guatemala",
      createdAt: NOW,
      updatedAt: NOW,
    });
    seedFullEntitlementPlan(db, TENANT_B);
    db.businessCapabilities.push({
      tenantId: TENANT_B,
      preset: BusinessPreset.custom,
      supportsInventory: true,
      supportsLots: false,
      supportsExpiration: false,
      supportsSerials: false,
      supportsMultipleLocations: true,
      supportsUnitsAndPackaging: true,
      supportsProductAttributes: false,
      supportsKits: false,
      supportsServices: false,
      defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
    });
    db.branches.push({
      id: BRANCH_B,
      tenantId: TENANT_B,
      code: "IHB",
      name: "Sucursal Inventory B",
      type: BranchType.store,
      status: BranchStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.categories.push({
      id: "cat-inventory-hardening-b",
      tenantId: TENANT_B,
      name: "Categoria Inventory B",
      slug: "categoria-inventory-b",
      status: "active" as never,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.units.push({
      id: "unit-inventory-hardening-b",
      tenantId: TENANT_B,
      code: "UIHB",
      name: "Unidad Inventory B",
      symbol: "uib",
      category: UnitCategory.unit,
      allowsDecimals: false,
      status: UnitStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.products.push({
      id: PRODUCT_B,
      tenantId: TENANT_B,
      sku: "INV-B",
      name: "Producto Inventory B",
      productType: ProductType.physical,
      categoryId: "cat-inventory-hardening-b",
      baseUnitId: "unit-inventory-hardening-b",
      saleUnitId: "unit-inventory-hardening-b",
      salePrice: 1,
      status: ProductStatus.published,
      tracking: { stock: true, lot: false, expiration: false, serial: false },
      channels: { ecommerce: false, pos: true, mobileApp: false },
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.storageLocations.push({
      id: "loc-inventory-hardening-b",
      tenantId: TENANT_B,
      branchId: BRANCH_B,
      code: "IHB-A",
      name: "Ubicacion B",
      type: "shelf",
      status: LocationStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.unitConversions.push({
      id: "conversion-inventory-hardening-hammer-box",
      tenantId: TENANT_A,
      productId: PRODUCT_HAMMER,
      fromUnitId: "unit-box",
      toUnitId: "unit-unit",
      factor: 5,
      createdAt: NOW,
    });
    db.supplierProducts.push({
      id: "supplier-product-inventory-hardening-hammer-box",
      tenantId: TENANT_A,
      supplierId: "supplier-construction",
      productId: PRODUCT_HAMMER,
      purchaseUnitId: "unit-box",
      purchaseToBaseFactor: 5,
      lastCost: 10,
      leadTimeDays: 1,
      minimumOrderQuantity: 1,
      preferred: false,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.inventoryBalances.push({
      id: "bal-inventory-hardening-b",
      tenantId: TENANT_B,
      branchId: BRANCH_B,
      productId: PRODUCT_B,
      locationId: "loc-inventory-hardening-b",
      quantity: 10,
      reservedQuantity: 0,
      minStock: 0,
      reorderPoint: 0,
      updatedAt: NOW,
    });
    db.inventoryBalances.push({
      id: "bal-inventory-hardening-screws-norte",
      tenantId: TENANT_A,
      branchId: BRANCH_NORTE,
      productId: PRODUCT_SCREWS,
      locationId: LOCATION_NORTE,
      quantity: 10,
      reservedQuantity: 0,
      updatedAt: NOW,
    });
  });

  function buildRepositories(session: Session): RepositoryRegistry {
    return {
      inventoryMovementsDataSource: "mock",
      auth: {
        getCurrentSessionId: async () => session.id,
        getSession: async (sessionId: string) =>
          sessionId === session.id ? { ...session } : null,
      },
      users: new MockUserRepository(store, eventBus),
      roles: new MockRoleRepository(store, eventBus),
      tenants: new MockTenantRepository(store, eventBus),
      branches: new MockBranchRepository(store, eventBus),
      categories: new MockCategoryRepository(store, eventBus),
      units: new MockUnitRepository(store, eventBus),
      products: new MockProductRepository(store, eventBus),
      supplierProducts: new MockSupplierProductRepository(store, eventBus),
      inventory: new MockInventoryRepository(store, eventBus),
      inventoryAdjustments: new MockInventoryAdjustmentRepository(store, eventBus),
      inventoryTransferRequests: new MockInventoryTransferRequestRepository(store, eventBus),
      inventoryTransfers: new MockInventoryTransferRepository(store, eventBus),
      purchaseOrders: new MockPurchaseOrderRepository(store, eventBus),
      receipts: new MockReceiptRepository(store, eventBus),
      dispatches: new MockDispatchRepository(store, eventBus),
      orders: new MockOrderRepository(store, eventBus),
      sales: new MockSalesRepository(store, eventBus),
      businessConfig: new MockBusinessConfigRepository(store, eventBus),
      productKitComponents: new MockProductKitComponentRepository(store, eventBus),
      plans: new MockPlanRepository(store, eventBus),
      tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    } as unknown as RepositoryRegistry;
  }

  function createSession(
    permissions: string[],
    allowedBranchIds: string[],
    tenantId = TENANT_A,
  ): RepositoryRegistry {
    const suffix = Math.random().toString(36).slice(2, 9);
    const roleId = `role-inventory-hardening-${suffix}`;
    const userId = `user-inventory-hardening-${suffix}`;
    const sessionId = `session-inventory-hardening-${suffix}`;
    store.mutate((db) => {
      db.roles.push({
        id: roleId,
        tenantId,
        name: `Inventory Hardening ${suffix}`,
        isSystem: false,
        permissions,
        branchScope: "selected",
        status: RoleStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      });
      db.users.push({
        id: userId,
        tenantId,
        name: `Inventory User ${suffix}`,
        email: `${suffix}@inventory-hardening.test`,
        type: UserType.employee,
        status: UserStatus.active,
        roleId,
        allowedBranchIds,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    return buildRepositories({ id: sessionId, userId, activeBranchId: allowedBranchIds[0] });
  }

  return { store, createSession };
}

const READ_PERMISSIONS = ["inventory.stock.read", "inventory.movements.read"];
const ADJUST_PERMISSION = "inventory.adjustment.create";
const TRANSFER_PERMISSION = "inventory.transfers.manage";

function movementParams(activeBranchId: string) {
  return {
    activeBranchId,
    page: 1,
    pageSize: 100,
    sort: "createdAt,desc" as const,
  };
}

async function expectDenied(action: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(action, pattern);
}

function inventoryEffectSnapshot(store: MockDatabaseStore) {
  const snapshot = store.getSnapshot();
  return {
    balances: snapshot.inventoryBalances,
    movements: snapshot.inventoryMovements,
    lots: snapshot.stockLots,
    serials: snapshot.serialNumbers,
  };
}

async function expectDeniedWithNoInventoryEffect(
  store: MockDatabaseStore,
  action: () => Promise<unknown>,
  pattern: RegExp,
) {
  const before = inventoryEffectSnapshot(store);
  await expectDenied(action, pattern);
  assert.deepEqual(inventoryEffectSnapshot(store), before);
}

async function main() {
  const harness = createHarness();

  const readOnly = harness.createSession(READ_PERMISSIONS, [BRANCH_CENTRO]);
  const alerts = await new GetInventoryAlertsService(readOnly).execute(BRANCH_CENTRO);
  assert.ok(alerts.rows.length > 0, "read-only stock read should return inventory rows");
  const movements = await new GetInventoryMovementsService(readOnly).execute(
    movementParams(BRANCH_CENTRO),
  );
  assert.ok(Array.isArray(movements.rows), "read-only movements read should return rows");
  await expectDenied(
    () => new GetInventoryAlertsService(readOnly).execute(BRANCH_NORTE),
    /No ten.*acceso|sucursal seleccionada/i,
  );
  await expectDenied(
    () => new GetInventoryAlertsService(readOnly).execute(BRANCH_B),
    /sucursal seleccionada/i,
  );
  await expectDenied(
    () => new GetInventoryMovementsService(readOnly).execute(movementParams(BRANCH_NORTE)),
    /No ten.*acceso|sucursal seleccionada/i,
  );
  await expectDenied(
    () => new GetInventoryMovementsService(readOnly).execute(movementParams(BRANCH_B)),
    /sucursal seleccionada/i,
  );

  await expectDeniedWithNoInventoryEffect(
    harness.store,
    () =>
      new RegisterInventoryAdjustmentService(readOnly).execute({
        productId: PRODUCT_SCREWS,
        branchId: BRANCH_CENTRO,
        locationId: LOCATION_CENTRO,
        unitId: "unit-unit",
        movementKind: "in",
        quantity: 1,
        reason: "No permission",
        notes: "",
      }),
    /permiso.*ajustes/i,
  );

  const adjuster = harness.createSession(
    [...READ_PERMISSIONS, ADJUST_PERMISSION],
    [BRANCH_CENTRO],
  );
  await expectDeniedWithNoInventoryEffect(
    harness.store,
    () =>
      new RegisterInventoryAdjustmentService(adjuster).execute({
        productId: PRODUCT_B,
        branchId: BRANCH_CENTRO,
        locationId: LOCATION_CENTRO,
        unitId: "unit-inventory-hardening-b",
        movementKind: "in",
        quantity: 1,
        reason: "Foreign product",
        notes: "",
      }),
    /Producto no encontrado/i,
  );
  await expectDeniedWithNoInventoryEffect(
    harness.store,
    () =>
      new RegisterInventoryAdjustmentService(adjuster).execute({
        productId: PRODUCT_SCREWS,
        branchId: BRANCH_NORTE,
        locationId: LOCATION_NORTE,
        unitId: "unit-unit",
        movementKind: "in",
        quantity: 1,
        reason: "Foreign branch",
        notes: "",
      }),
    /No ten.*acceso|sucursal seleccionada/i,
  );
  await expectDeniedWithNoInventoryEffect(
    harness.store,
    () =>
      new RegisterInventoryAdjustmentService(adjuster).execute({
        productId: PRODUCT_SCREWS,
        branchId: BRANCH_CENTRO,
        locationId: LOCATION_NORTE,
        unitId: "unit-box",
        movementKind: "in",
        quantity: 1,
        reason: "Wrong branch location",
        notes: "",
      }),
    /ubicaci.*no est.*disponible/i,
  );
  await expectDeniedWithNoInventoryEffect(
    harness.store,
    () =>
      new RegisterInventoryAdjustmentService(adjuster).execute({
        productId: PRODUCT_SCREWS,
        branchId: BRANCH_CENTRO,
        locationId: LOCATION_B,
        unitId: "unit-box",
        movementKind: "in",
        quantity: 1,
        reason: "Wrong tenant location",
        notes: "",
      }),
    /ubicaci.*no est.*disponible/i,
  );

  await expectDenied(
    () =>
      new CreateTransferRequestService(readOnly).execute({
        productId: PRODUCT_SCREWS,
        requesterBranchId: BRANCH_CENTRO,
        providerBranchId: BRANCH_NORTE,
        quantity: 1,
        reason: InventoryTransferReason.replenishment,
        notes: "",
      }),
    /permiso.*traslados/i,
  );

  const requester = harness.createSession(
    [...READ_PERMISSIONS, TRANSFER_PERMISSION],
    [BRANCH_CENTRO],
  );
  const created = await new CreateTransferRequestService(requester).execute({
    productId: PRODUCT_SCREWS,
    requesterBranchId: BRANCH_CENTRO,
    providerBranchId: BRANCH_NORTE,
    quantity: 3,
    reason: InventoryTransferReason.replenishment,
    notes: "Authorized create",
  });
  assert.equal(created.tenantId, TENANT_A);
  assert.equal(created.requestingBranchId, BRANCH_CENTRO);
  assert.equal(created.sourceBranchId, BRANCH_NORTE);

  const ownPending = await new CreateTransferRequestService(requester).execute({
    productId: PRODUCT_SCREWS,
    requesterBranchId: BRANCH_CENTRO,
    providerBranchId: BRANCH_NORTE,
    quantity: 1,
    reason: InventoryTransferReason.replenishment,
    notes: "Withdrawal permission",
  });
  await expectDenied(() => new CancelTransferRequestService(readOnly).execute(ownPending.id),
    /permiso.*traslados/i);
  assert.equal((await new CancelTransferRequestService(requester)
    .execute(ownPending.id)).status, "cancelled");

  const reviewer = harness.createSession(
    [...READ_PERMISSIONS, TRANSFER_PERMISSION],
    [BRANCH_NORTE],
  );
  const approved = await new ApproveTransferRequestService(reviewer).execute(created.id);
  assert.equal(approved.sourceRequestIds?.[0], created.id);
  const approvedRequest = await reviewer.inventoryTransferRequests.getById(created.id);
  assert.equal(approvedRequest?.status, "approved");
  assert.ok(approvedRequest?.reviewedByUserId);
  await expectDenied(() => new CancelTransferRequestService(requester).execute(created.id),
    /Solo puede cancelarse/);

  const createdForReject = await new CreateTransferRequestService(requester).execute({
    productId: PRODUCT_SCREWS,
    requesterBranchId: BRANCH_CENTRO,
    providerBranchId: BRANCH_NORTE,
    quantity: 2,
    reason: InventoryTransferReason.demandCoverage,
    notes: "Authorized reject",
  });
  const rejected = await new RejectTransferRequestService(reviewer).execute(
    createdForReject.id,
    "Sin disponibilidad operativa",
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectionReason, "Sin disponibilidad operativa");

  const hookSource = readFileSync("src/modules/inventory/hooks/useInventoryAlerts.ts", "utf8");
  assert.equal(hookSource.includes("inventoryTransferRequests.createRequest"), false);
  assert.equal(hookSource.includes("inventoryTransferRequests.approveRequest"), false);
  assert.equal(hookSource.includes("inventoryTransferRequests.rejectRequest"), false);
  assert.equal(hookSource.includes("inventoryTransferRequests.cancelRequest"), false);

  await expectDenied(
    () =>
      new CreateTransferRequestService(requester).execute({
        productId: PRODUCT_SCREWS,
        requesterBranchId: BRANCH_CENTRO,
        providerBranchId: BRANCH_B,
        quantity: 1,
        reason: InventoryTransferReason.replenishment,
        notes: "Cross tenant branch",
      }),
    /sucursal seleccionada/i,
  );
  await expectDenied(
    () =>
      new CreateTransferRequestService(requester).execute({
        productId: PRODUCT_B,
        requesterBranchId: BRANCH_CENTRO,
        providerBranchId: BRANCH_NORTE,
        quantity: 1,
        reason: InventoryTransferReason.replenishment,
        notes: "Cross tenant product",
      }),
    /Producto no encontrado/i,
  );

  const traceable = await new RegisterInventoryAdjustmentService(adjuster).execute({
    productId: PRODUCT_HAMMER,
    branchId: BRANCH_CENTRO,
    locationId: LOCATION_CENTRO,
    unitId: "unit-box",
    movementKind: "in",
    quantity: 2,
    reason: "Conversion intact",
    notes: "Preserve canonical quantity",
  });
  assert.equal(traceable.movement.quantity, 10);
  assert.equal(traceable.movement.quantityAfter, traceable.movement.quantityBefore! + 10);
  assert.equal(traceable.movement.branchId, BRANCH_CENTRO);
  assert.equal(traceable.movement.productId, PRODUCT_HAMMER);

  console.log("inventory permission hardening verification: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
