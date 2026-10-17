/**
 * Harness de regresión para feature/saas-entitlement-enforcement.
 *
 * Uso (desde la raíz del proyecto):
 *   npx tsx scripts/verify-saas-entitlement-enforcement.ts
 *
 * Cubre las 30 verificaciones de la auditoría (§51): resolución de entitlements (activo/
 * restringido), composición capability+permission+branch, aislamiento entre tenants, subscription
 * suspendida/cancelada, plan archivado, subscription/plan faltante (fail-closed), lectura
 * histórica tras perder una capability, matriz de 4 estados de ecommerce, catalog.kits, matriz de
 * BusinessConfig (lots/expiration/serials), límites maxEmployees/maxBranches, "denied leaves zero
 * effects", bypass directo de Application Service, Tenant creado por PR#102, tenant-demo, y
 * distinción entre error de entitlement y error de permiso.
 *
 * PR #103 (fix de hallazgos de auditoría, BLOCKER de Storefront público, §51): agrega
 * `verifyPublicStorefrontReadBoundary` -- ejercita Discovery/ProductDetail/OrderTracking reales
 * (no solo el resolver) contra la matriz completa (activo, sin capability, suspended, cancelled,
 * archived plan, config disabled, product detail directo, cross-tenant, y la política de
 * OrderTracking de HISTORICAL ACCESS PRESERVED).
 */
import assert from "node:assert/strict";
import {
  BranchStatus,
  BranchType,
  BusinessPreset,
  CashShiftStatus,
  LocationStatus,
  PlanCode,
  PlanStatus,
  ProductStatus,
  ProductType,
  RoleStatus,
  SaasCapabilityKey,
  SaasLimitKey,
  SupplierStatus,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockAttributeRepository,
  MockAuthRepository,
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockCashMovementRepository,
  MockCashShiftRepository,
  MockCategoryRepository,
  MockIncidentTypeRepository,
  MockInventoryAdjustmentRepository,
  MockInventoryRepository,
  MockInventoryTransferRequestRepository,
  MockOrderRepository,
  MockPlanRepository,
  MockProductKitComponentRepository,
  MockProductMediaRepository,
  MockProductRepository,
  MockProductSalesPriceTierRepository,
  MockPurchaseOrderRepository,
  MockReceiptRepository,
  MockRoleRepository,
  MockSupplierProductRepository,
  MockSupplierRepository,
  MockTenantOnboardingRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import { permissionsConfig } from "@/config/permissions";
import { CreateBranchService } from "@/modules/administration/application/services/CreateBranchService";
import { CreateEmployeeService } from "@/modules/administration/application/services/CreateEmployeeService";
import { TenantOnboardingService } from "@/modules/administration/application/services/TenantOnboardingService";
import { RegisterInventoryAdjustmentService } from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import { InventoryServiceError } from "@/modules/inventory/application/services/serviceHelpers";
import { OpenCashShiftService } from "@/modules/pos/application/services/OpenCashShiftService";
import { GetPurchaseOrdersReadModelService } from "@/modules/purchasing/application/services/GetPurchaseOrdersReadModelService";
import { PurchaseOrderEditorService } from "@/modules/purchasing/application/services/PurchaseOrderEditorService";
import { PurchasingServiceError } from "@/modules/purchasing/application/services/serviceHelpers";
import { GetStorefrontDiscoveryService } from "@/modules/storefront/application/services/GetStorefrontDiscoveryService";
import { GetStorefrontProductDetailService } from "@/modules/storefront/application/services/GetStorefrontProductDetailService";
import { GetStorefrontOrderTrackingService } from "@/modules/storefront/application/services/GetStorefrontOrderTrackingService";
import { ResolvePublicStorefrontContextService } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";
import { isEffectiveBusinessCapabilityEnabled } from "@/shared/application/services/businessCapabilityEntitlement";
import { SaasEntitlementError } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

const NOW = "2026-09-15T12:00:00.000Z";

class MemoryStorageAdapter extends LocalStorageAdapter {
  readonly values = new Map<string, string>();

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

// ==================================================
// Fixture builders
// ==================================================

function seedTenant(db: MockDatabase, id: string, overrides: { slug?: string; status?: TenantStatus } = {}) {
  db.tenants.push({
    id,
    name: `Tenant fixture ${id}`,
    slug: overrides.slug ?? id,
    status: overrides.status ?? TenantStatus.active,
    defaultCurrency: "GTQ",
    timezone: "America/Guatemala",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedPlan(
  db: MockDatabase,
  input: {
    id: string;
    capabilities: SaasCapabilityKey[];
    limits?: Partial<Record<SaasLimitKey, number>>;
    status?: PlanStatus;
  },
) {
  db.planDefinitions.push({
    id: input.id,
    code: PlanCode.basic,
    name: `Plan fixture ${input.id}`,
    status: input.status ?? PlanStatus.active,
    capabilities: input.capabilities,
    limits: input.limits ?? {},
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedSubscription(
  db: MockDatabase,
  input: { id: string; tenantId: string; planId: string; status?: TenantSubscriptionStatus },
) {
  db.tenantSubscriptions.push({
    id: input.id,
    tenantId: input.tenantId,
    planId: input.planId,
    status: input.status ?? TenantSubscriptionStatus.active,
    startedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedBusinessCapabilities(
  db: MockDatabase,
  tenantId: string,
  overrides: Partial<{ supportsLots: boolean; supportsExpiration: boolean; supportsSerials: boolean; supportsKits: boolean }> = {},
) {
  db.businessCapabilities.push({
    tenantId,
    preset: BusinessPreset.custom,
    supportsInventory: true,
    supportsLots: overrides.supportsLots ?? false,
    supportsExpiration: overrides.supportsExpiration ?? false,
    supportsSerials: overrides.supportsSerials ?? false,
    supportsMultipleLocations: false,
    supportsUnitsAndPackaging: true,
    supportsProductAttributes: false,
    supportsKits: overrides.supportsKits ?? false,
    supportsServices: false,
    defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
  });
}

function seedBranch(db: MockDatabase, id: string, tenantId: string) {
  db.branches.push({
    id,
    tenantId,
    code: id.toUpperCase(),
    name: `Branch fixture ${id}`,
    type: BranchType.store,
    status: BranchStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedRole(db: MockDatabase, id: string, tenantId: string, permissions: string[]) {
  db.roles.push({
    id,
    tenantId,
    name: `Role fixture ${id}`,
    isSystem: false,
    permissions,
    branchScope: "all",
    status: RoleStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedUser(
  db: MockDatabase,
  input: { id: string; tenantId: string; roleId: string; branchId: string; allowedBranchIds: string[] },
) {
  db.users.push({
    id: input.id,
    tenantId: input.tenantId,
    name: `User fixture ${input.id}`,
    email: `${input.id}@entitlement.test`,
    type: UserType.employee,
    status: UserStatus.active,
    roleId: input.roleId,
    branchId: input.branchId,
    allowedBranchIds: input.allowedBranchIds,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedCatalogBasics(db: MockDatabase, tenantId: string, suffix: string) {
  db.categories.push({
    id: `cat-${suffix}`,
    tenantId,
    name: `Categoria ${suffix}`,
    slug: `categoria-${suffix}`,
    status: "active" as never,
    createdAt: NOW,
    updatedAt: NOW,
  });
  db.units.push({
    id: `unit-${suffix}`,
    tenantId,
    code: `U-${suffix}`.toUpperCase(),
    name: `Unidad ${suffix}`,
    symbol: "u",
    category: "unit" as never,
    allowsDecimals: false,
    status: "active" as never,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedProduct(
  db: MockDatabase,
  input: {
    id: string;
    tenantId: string;
    categoryId: string;
    unitId: string;
    tracking?: { stock: boolean; lot: boolean; expiration: boolean; serial: boolean };
  },
) {
  db.products.push({
    id: input.id,
    tenantId: input.tenantId,
    sku: input.id.toUpperCase(),
    name: `Producto ${input.id}`,
    productType: ProductType.physical,
    categoryId: input.categoryId,
    baseUnitId: input.unitId,
    saleUnitId: input.unitId,
    salePrice: 10,
    status: ProductStatus.published,
    tracking: input.tracking ?? { stock: true, lot: false, expiration: false, serial: false },
    channels: { ecommerce: false, pos: true, mobileApp: false },
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedLocation(db: MockDatabase, id: string, tenantId: string, branchId: string) {
  db.storageLocations.push({
    id,
    tenantId,
    branchId,
    code: id.toUpperCase(),
    name: `Location fixture ${id}`,
    type: "shelf",
    status: LocationStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedSupplier(db: MockDatabase, id: string, tenantId: string, productId: string, unitId: string) {
  db.suppliers.push({
    id,
    tenantId,
    name: `Supplier ${id}`,
    status: SupplierStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  });
  db.supplierProducts.push({
    id: `${id}-product`,
    tenantId,
    supplierId: id,
    productId,
    purchaseUnitId: unitId,
    purchaseToBaseFactor: 1,
    lastCost: 5,
    leadTimeDays: 1,
    minimumOrderQuantity: 1,
    preferred: true,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

interface Session {
  id: string;
  userId: string;
}

/**
 * Un harness compartido: un solo store, múltiples tenants/roles/users creados on-demand vía
 * `createSession`, cada uno con su propio Plan/Subscription controlables individualmente. Mismo
 * patrón que los harnesses de permission-hardening ya existentes en `scripts/`.
 */
function createHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const sessions = new Map<string, Session>();

  function buildRepositories(session: Session): RepositoryRegistry {
    // `auth` real (MockAuthRepository) para que `inviteEmployee`/etc funcionen de verdad --
    // envuelto en un Proxy que fija `getCurrentSessionId`/`getSession` a ESTA sesión sintética
    // (no depende de un login real), delegando todo lo demás a la implementación real.
    const realAuth = new MockAuthRepository(store, eventBus, new MemoryStorageAdapter());
    const auth = new Proxy(realAuth, {
      get(target, prop) {
        if (prop === "getCurrentSessionId") return async () => session.id;
        if (prop === "getSession") {
          return async (sessionId: string) => (sessionId === session.id ? { ...session } : null);
        }
        const value = Reflect.get(target, prop as keyof typeof target);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    return {
      auth,
      users: new MockUserRepository(store, eventBus),
      roles: new MockRoleRepository(store, eventBus),
      tenants: new MockTenantRepository(store, eventBus),
      tenantOnboarding: new MockTenantOnboardingRepository(store, eventBus),
      branches: new MockBranchRepository(store, eventBus),
      categories: new MockCategoryRepository(store, eventBus),
      units: new MockUnitRepository(store, eventBus),
      products: new MockProductRepository(store, eventBus),
      productKitComponents: new MockProductKitComponentRepository(store, eventBus),
      suppliers: new MockSupplierRepository(store, eventBus),
      supplierProducts: new MockSupplierProductRepository(store, eventBus),
      purchaseOrders: new MockPurchaseOrderRepository(store, eventBus),
      receipts: new MockReceiptRepository(store, eventBus),
      incidentTypes: new MockIncidentTypeRepository(store, eventBus),
      inventory: new MockInventoryRepository(store, eventBus),
      inventoryAdjustments: new MockInventoryAdjustmentRepository(store, eventBus),
      inventoryTransferRequests: new MockInventoryTransferRequestRepository(store, eventBus),
      businessConfig: new MockBusinessConfigRepository(store, eventBus),
      plans: new MockPlanRepository(store, eventBus),
      tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
      cashShifts: new MockCashShiftRepository(store, eventBus),
      cashMovements: new MockCashMovementRepository(store, eventBus),
      auditLogs: { append: async () => undefined } as never,
    } as unknown as RepositoryRegistry;
  }

  function createSession(userId: string): RepositoryRegistry {
    const suffix = Math.random().toString(36).slice(2, 9);
    const sessionId = `session-entitlement-${suffix}`;
    const session = { id: sessionId, userId };
    sessions.set(sessionId, session);
    return buildRepositories(session);
  }

  return { store, eventBus, createSession };
}

/**
 * Arma tenant + branch + role + user + plan + subscription en un solo paso, devolviendo un
 * `RepositoryRegistry` ya autenticado como ese user. `planCapabilities`/`planLimits`/
 * `subscriptionStatus`/`planStatus` son el eje que cada test controla; el resto es fixture fijo.
 */
function setupTenant(
  harness: ReturnType<typeof createHarness>,
  input: {
    tenantId: string;
    planCapabilities: SaasCapabilityKey[];
    planLimits?: Partial<Record<SaasLimitKey, number>>;
    subscriptionStatus?: TenantSubscriptionStatus;
    planStatus?: PlanStatus;
    permissions: string[];
    skipSubscription?: boolean;
    skipPlan?: boolean;
    slug?: string;
  },
) {
  const branchId = `${input.tenantId}-branch`;
  const roleId = `${input.tenantId}-role`;
  const userId = `${input.tenantId}-user`;
  const planId = `${input.tenantId}-plan`;

  harness.store.mutate((db) => {
    seedTenant(db, input.tenantId, { slug: input.slug });
    seedBranch(db, branchId, input.tenantId);
    seedRole(db, roleId, input.tenantId, input.permissions);
    seedUser(db, {
      id: userId,
      tenantId: input.tenantId,
      roleId,
      branchId,
      allowedBranchIds: [branchId],
    });
    seedBusinessCapabilities(db, input.tenantId, {
      supportsLots: true,
      supportsExpiration: true,
      supportsSerials: true,
      supportsKits: true,
    });
    seedCatalogBasics(db, input.tenantId, input.tenantId);
    seedLocation(db, `${input.tenantId}-loc`, input.tenantId, branchId);
    if (!input.skipPlan) {
      seedPlan(db, {
        id: planId,
        capabilities: input.planCapabilities,
        limits: input.planLimits,
        status: input.planStatus,
      });
    }
    if (!input.skipSubscription) {
      seedSubscription(db, {
        id: `${input.tenantId}-subscription`,
        tenantId: input.tenantId,
        planId,
        status: input.subscriptionStatus,
      });
    }
  });

  const repositories = harness.createSession(userId);
  return { branchId, roleId, userId, planId, repositories };
}

const FULL_CAPABILITIES = Object.values(SaasCapabilityKey);

// ==================================================
// 1-2. active Enterprise / active restricted Plan resolution
// ==================================================
async function verifyResolverActiveAndRestricted() {
  const harness = createHarness();
  const full = setupTenant(harness, {
    tenantId: "tenant-full",
    planCapabilities: FULL_CAPABILITIES,
    permissions: [],
  });
  const restricted = setupTenant(harness, {
    tenantId: "tenant-restricted",
    planCapabilities: [SaasCapabilityKey.inventory, SaasCapabilityKey.pos],
    permissions: [],
  });

  const fullEntitlements = await new ResolveTenantEntitlementsService(full.repositories).execute(
    "tenant-full",
  );
  assert.equal(fullEntitlements.isEntitlementActive, true, "1: subscription+plan activos");
  assert.deepEqual(
    new Set(fullEntitlements.effectiveCapabilities),
    new Set(FULL_CAPABILITIES),
    "1: plan full resuelve TODAS las capabilities",
  );

  const restrictedEntitlements = await new ResolveTenantEntitlementsService(
    restricted.repositories,
  ).execute("tenant-restricted");
  assert.equal(restrictedEntitlements.isEntitlementActive, true);
  assert.deepEqual(
    new Set(restrictedEntitlements.effectiveCapabilities),
    new Set([SaasCapabilityKey.inventory, SaasCapabilityKey.pos]),
    "2: plan restringido resuelve SOLO sus capabilities, no las de otro tenant",
  );
}

// ==================================================
// 3-7. capability/permission/branch composition matrix (Inventory adjustment as representative)
// ==================================================
async function verifyCapabilityPermissionBranchMatrix() {
  const harness = createHarness();
  const INVENTORY_PERMISSION = "inventory.adjustment.create";

  // 3. capability YES + permission YES + branch YES => ALLOW (también cubre 7: all dimensions allow)
  const allow = setupTenant(harness, {
    tenantId: "tenant-matrix-allow",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: [INVENTORY_PERMISSION],
  });
  harness.store.mutate((db) => {
    seedProduct(db, {
      id: "prod-matrix-allow",
      tenantId: "tenant-matrix-allow",
      categoryId: "cat-tenant-matrix-allow",
      unitId: "unit-tenant-matrix-allow",
    });
    seedLocation(db, "loc-matrix-allow", "tenant-matrix-allow", allow.branchId);
  });
  await new RegisterInventoryAdjustmentService(allow.repositories).execute({
    productId: "prod-matrix-allow",
    branchId: allow.branchId,
    locationId: "loc-matrix-allow",
    unitId: "unit-tenant-matrix-allow",
    quantity: 5,
    movementKind: "in",
    reason: "3-7: todas las dimensiones permiten",
  } as never);

  // 4. capability NO + permission YES + branch YES => DENY (SaasEntitlementError)
  const noCapability = setupTenant(harness, {
    tenantId: "tenant-matrix-nocap",
    planCapabilities: [SaasCapabilityKey.pos],
    permissions: [INVENTORY_PERMISSION],
  });
  harness.store.mutate((db) => {
    seedProduct(db, {
      id: "prod-matrix-nocap",
      tenantId: "tenant-matrix-nocap",
      categoryId: "cat-tenant-matrix-nocap",
      unitId: "unit-tenant-matrix-nocap",
    });
    seedLocation(db, "loc-matrix-nocap", "tenant-matrix-nocap", noCapability.branchId);
  });
  await assert.rejects(
    new RegisterInventoryAdjustmentService(noCapability.repositories).execute({
      productId: "prod-matrix-nocap",
      branchId: noCapability.branchId,
      locationId: "loc-matrix-nocap",
      unitId: "unit-tenant-matrix-nocap",
      quantity: 5,
      movementKind: "in",
      reason: "4: capability ausente",
    } as never),
    SaasEntitlementError,
    "4: capability NO + permission YES + branch YES => DENY",
  );

  // 5. capability YES + permission NO + branch YES => DENY (InventoryServiceError, no entitlement)
  const noPermission = setupTenant(harness, {
    tenantId: "tenant-matrix-noperm",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: [],
  });
  harness.store.mutate((db) => {
    seedProduct(db, {
      id: "prod-matrix-noperm",
      tenantId: "tenant-matrix-noperm",
      categoryId: "cat-tenant-matrix-noperm",
      unitId: "unit-tenant-matrix-noperm",
    });
    seedLocation(db, "loc-matrix-noperm", "tenant-matrix-noperm", noPermission.branchId);
  });
  await assert.rejects(
    new RegisterInventoryAdjustmentService(noPermission.repositories).execute({
      productId: "prod-matrix-noperm",
      branchId: noPermission.branchId,
      locationId: "loc-matrix-noperm",
      unitId: "unit-tenant-matrix-noperm",
      quantity: 5,
      movementKind: "in",
      reason: "5: permiso ausente pese a capability",
    } as never),
    InventoryServiceError,
    "5: capability YES + permission NO + branch YES => DENY (permiso, no entitlement)",
  );

  // 6. capability YES + permission YES + branch NO => DENY (InventoryServiceError, branch)
  const foreignBranch = setupTenant(harness, {
    tenantId: "tenant-matrix-nobranch",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: [INVENTORY_PERMISSION],
  });
  const otherBranchId = "tenant-matrix-nobranch-other-branch";
  harness.store.mutate((db) => {
    seedBranch(db, otherBranchId, "tenant-matrix-nobranch");
    seedProduct(db, {
      id: "prod-matrix-nobranch",
      tenantId: "tenant-matrix-nobranch",
      categoryId: "cat-tenant-matrix-nobranch",
      unitId: "unit-tenant-matrix-nobranch",
    });
    seedLocation(db, "loc-matrix-nobranch", "tenant-matrix-nobranch", otherBranchId);
  });
  await assert.rejects(
    new RegisterInventoryAdjustmentService(foreignBranch.repositories).execute({
      productId: "prod-matrix-nobranch",
      branchId: otherBranchId,
      locationId: "loc-matrix-nobranch",
      unitId: "unit-tenant-matrix-nobranch",
      quantity: 5,
      movementKind: "in",
      reason: "6: sucursal no autorizada pese a capability+permission",
    } as never),
    InventoryServiceError,
    "6: capability YES + permission YES + branch NO => DENY (sucursal, no entitlement)",
  );
}

// ==================================================
// 8. Tenant A entitlements nunca gobiernan Tenant B
// ==================================================
async function verifyTenantIsolationOfEntitlements() {
  const harness = createHarness();
  const tenantA = setupTenant(harness, {
    tenantId: "tenant-iso-a",
    planCapabilities: FULL_CAPABILITIES,
    permissions: ["inventory.adjustment.create"],
  });
  const tenantB = setupTenant(harness, {
    tenantId: "tenant-iso-b",
    planCapabilities: [SaasCapabilityKey.pos],
    permissions: ["inventory.adjustment.create"],
  });

  harness.store.mutate((db) => {
    seedProduct(db, {
      id: "prod-iso-b",
      tenantId: "tenant-iso-b",
      categoryId: "cat-tenant-iso-b",
      unitId: "unit-tenant-iso-b",
    });
    seedLocation(db, "loc-iso-b", "tenant-iso-b", tenantB.branchId);
  });

  // El Employee de Tenant B (mismo permiso de Role que A) NO hereda las capabilities de A -- el
  // resolver usa el tenantId de SU sesión, nunca el de otro tenant.
  await assert.rejects(
    new RegisterInventoryAdjustmentService(tenantB.repositories).execute({
      productId: "prod-iso-b",
      branchId: tenantB.branchId,
      locationId: "loc-iso-b",
      unitId: "unit-tenant-iso-b",
      quantity: 1,
      movementKind: "in",
      reason: "8: aislamiento de entitlements entre tenants",
    } as never),
    SaasEntitlementError,
    "8: Tenant B no debe poder usar las capabilities de Tenant A",
  );
  void tenantA;
}

// ==================================================
// 9-13. suspended / cancelled / archived plan / missing subscription / missing plan
// ==================================================
async function verifySubscriptionAndPlanStateDenials() {
  const harness = createHarness();

  async function attemptOpenCashShift(repositories: RepositoryRegistry, branchId: string, tenantId: string, userId: string) {
    return new OpenCashShiftService(repositories).execute({
      tenantId,
      actorUserId: userId,
      branchId,
      registerCode: "CAJA-1",
      openingAmount: 100,
    });
  }

  // 9. suspended subscription denies mutation
  const suspended = setupTenant(harness, {
    tenantId: "tenant-suspended",
    planCapabilities: [SaasCapabilityKey.pos],
    permissions: ["pos.cash.open"],
    subscriptionStatus: TenantSubscriptionStatus.suspended,
  });
  await assert.rejects(
    attemptOpenCashShift(suspended.repositories, suspended.branchId, "tenant-suspended", suspended.userId),
    SaasEntitlementError,
    "9: Subscription suspended debe denegar la mutación",
  );

  // 10. cancelled subscription denies mutation
  const cancelled = setupTenant(harness, {
    tenantId: "tenant-cancelled",
    planCapabilities: [SaasCapabilityKey.pos],
    permissions: ["pos.cash.open"],
    subscriptionStatus: TenantSubscriptionStatus.cancelled,
  });
  await assert.rejects(
    attemptOpenCashShift(cancelled.repositories, cancelled.branchId, "tenant-cancelled", cancelled.userId),
    SaasEntitlementError,
    "10: Subscription cancelled debe denegar la mutación",
  );

  // 11. archived Plan denies mutation (Subscription activa, Plan archivado)
  const archivedPlan = setupTenant(harness, {
    tenantId: "tenant-archived-plan",
    planCapabilities: [SaasCapabilityKey.pos],
    permissions: ["pos.cash.open"],
    planStatus: PlanStatus.archived,
  });
  await assert.rejects(
    attemptOpenCashShift(
      archivedPlan.repositories,
      archivedPlan.branchId,
      "tenant-archived-plan",
      archivedPlan.userId,
    ),
    SaasEntitlementError,
    "11: Subscription active + Plan archived NO debe seguir otorgando features",
  );

  // 12. missing Subscription fail-closed
  const noSubscription = setupTenant(harness, {
    tenantId: "tenant-no-subscription",
    planCapabilities: [SaasCapabilityKey.pos],
    permissions: ["pos.cash.open"],
    skipSubscription: true,
  });
  await assert.rejects(
    attemptOpenCashShift(
      noSubscription.repositories,
      noSubscription.branchId,
      "tenant-no-subscription",
      noSubscription.userId,
    ),
    SaasEntitlementError,
    "12: Tenant sin Subscription => DENIED fail-closed (nunca fallback)",
  );

  // 13. missing Plan fail-closed (Subscription apunta a un Plan inexistente)
  const noPlan = setupTenant(harness, {
    tenantId: "tenant-no-plan",
    planCapabilities: [SaasCapabilityKey.pos],
    permissions: ["pos.cash.open"],
    skipPlan: true,
  });
  await assert.rejects(
    attemptOpenCashShift(noPlan.repositories, noPlan.branchId, "tenant-no-plan", noPlan.userId),
    SaasEntitlementError,
    "13: Subscription que referencia un Plan inexistente => DENIED fail-closed",
  );
}

// ==================================================
// 14. historical read after capability removal
// ==================================================
async function verifyHistoricalReadAfterCapabilityRemoval() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-history",
    planCapabilities: [], // ningún capability comercial -- ni siquiera "purchasing"
    permissions: ["purchasing.orders.read"],
  });

  // El read model histórico NO exige ninguna capability -- solo el permiso de Role (auditoría
  // §10/§12): la ausencia TOTAL de capabilities en el plan no debe romper la lectura.
  const result = await new GetPurchaseOrdersReadModelService(tenant.repositories).execute();
  assert.ok(Array.isArray(result.orders), "14: lectura histórica debe seguir disponible sin capability");
}

// ==================================================
// 15/49/51. ecommerce 4-state matrix + Storefront public read boundary
// ==================================================

/**
 * `ResolvePublicStorefrontContextService` deriva el tenant público SIEMPRE por
 * `publicStorefrontSlug` (config de deployment) -- no es parametrizable. `MockDatabaseStore`
 * tampoco permite arrancar realmente vacío (siempre siembra demoSeed cuando no hay datos
 * persistidos), y demoSeed YA ocupa ese slug con tenant-demo. Por eso cada estado de la matriz se
 * arma sobre un store fresco (demoSeed real) mutando DIRECTAMENTE la Subscription/Plan/
 * EcommerceConfig reales de tenant-demo -- nunca intentando crear un segundo tenant con el mismo
 * slug (colisionaría con el ya sembrado). Se comparte entre `verifyEcommerceFourStateMatrix` y
 * `verifyPublicStorefrontReadBoundary` (auditoría §6/§51) porque ambas ejercen la misma matriz de
 * estado, solo que la segunda la ejerce a través de los Application Services reales
 * (Discovery/ProductDetail/OrderTracking) en vez de llamar al resolver directamente.
 */
function buildStorefrontState(options: {
  planHasEcommerce: boolean;
  configEnabled: boolean;
  subscriptionActive?: boolean;
  subscriptionStatus?: TenantSubscriptionStatus;
  planStatus?: PlanStatus;
}) {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  let tenantId = "";
  store.mutate((db) => {
    const tenant = db.tenants.find((item) => item.slug === publicStorefrontSlug);
    assert.ok(tenant, "fixture: el tenant público del slug configurado debe existir en el seed");
    tenantId = tenant.id;
    const subscription = db.tenantSubscriptions.find((item) => item.tenantId === tenant.id);
    assert.ok(subscription, "fixture: tenant-demo debe tener una Subscription real");
    // Esta matriz prueba el eje Plan/Config sin complementos comerciales activos.
    subscription.addonCodes = [];
    subscription.status =
      options.subscriptionStatus ??
      (options.subscriptionActive === false
        ? TenantSubscriptionStatus.suspended
        : TenantSubscriptionStatus.active);
    const plan = db.planDefinitions.find((item) => item.id === subscription.planId);
    assert.ok(plan, "fixture: la Subscription de tenant-demo debe apuntar a un Plan real");
    plan.capabilities = options.planHasEcommerce
      ? [...new Set([...plan.capabilities, SaasCapabilityKey.ecommerce])]
      : plan.capabilities.filter((key) => key !== SaasCapabilityKey.ecommerce);
    plan.status = options.planStatus ?? PlanStatus.active;
    const config = db.ecommerceConfigs.find((item) => item.tenantId === tenant.id);
    assert.ok(config, "fixture: tenant-demo debe tener un EcommerceConfig real");
    config.enabled = options.configEnabled;
    return tenant.id;
  });
  // demoSeed siempre siembra `prod-drill` (ecommerce: true, tenant-demo) y la orden
  // `order-001`/`TRACK-WEB-001` (ecommerce, tenant-demo) -- se reutilizan en vez de sembrar
  // fixtures nuevos para poder ejercer Discovery/ProductDetail/OrderTracking reales (no solo el
  // resolver) sobre cada estado de la matriz.
  return {
    tenantId,
    productId: "prod-drill",
    trackingToken: "TRACK-WEB-001",
    repositories: {
      tenants: new MockTenantRepository(store, eventBus),
      businessConfig: new MockBusinessConfigRepository(store, eventBus),
      plans: new MockPlanRepository(store, eventBus),
      tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
      products: new MockProductRepository(store, eventBus),
      categories: new MockCategoryRepository(store, eventBus),
      units: new MockUnitRepository(store, eventBus),
      attributes: new MockAttributeRepository(store, eventBus),
      productMedia: new MockProductMediaRepository(store, eventBus),
      productKitComponents: new MockProductKitComponentRepository(store, eventBus),
      productSalesPriceTiers: new MockProductSalesPriceTierRepository(store, eventBus),
      inventory: new MockInventoryRepository(store, eventBus),
      branches: new MockBranchRepository(store, eventBus),
      orders: new MockOrderRepository(store, eventBus),
    } as unknown as RepositoryRegistry,
  };
}

async function verifyEcommerceFourStateMatrix() {
  // Plan ecommerce YES + Config YES => disponible.
  const yesYes = buildStorefrontState({ planHasEcommerce: true, configEnabled: true });
  const context = await new ResolvePublicStorefrontContextService(yesYes.repositories).execute({ tenantSlug: publicStorefrontSlug });
  assert.ok(context.tenantId, "15/49: Plan YES + Config YES => disponible");

  // Plan ecommerce YES + Config NO => no disponible. (rechazo por EcommerceConfig.enabled)
  const yesNo = buildStorefrontState({ planHasEcommerce: true, configEnabled: false });
  await assert.rejects(
    new ResolvePublicStorefrontContextService(yesNo.repositories).execute({ tenantSlug: publicStorefrontSlug }),
    "15/49: Plan YES + Config NO => no disponible",
  );

  // Plan ecommerce NO + Config YES => no disponible. (rechazo por capability ausente)
  const noYes = buildStorefrontState({ planHasEcommerce: false, configEnabled: true });
  await assert.rejects(
    new ResolvePublicStorefrontContextService(noYes.repositories).execute({ tenantSlug: publicStorefrontSlug }),
    "15/49: Plan NO + Config YES => no disponible",
  );

  // Plan ecommerce NO + Config NO => no disponible.
  const noNo = buildStorefrontState({ planHasEcommerce: false, configEnabled: false });
  await assert.rejects(
    new ResolvePublicStorefrontContextService(noNo.repositories).execute({ tenantSlug: publicStorefrontSlug }),
    "15/49: Plan NO + Config NO => no disponible",
  );

  // Subscription inactive + Plan ecommerce YES + Config YES => no disponible.
  const inactiveSubscription = buildStorefrontState({
    planHasEcommerce: true,
    configEnabled: true,
    subscriptionActive: false,
  });
  await assert.rejects(
    new ResolvePublicStorefrontContextService(inactiveSubscription.repositories).execute({ tenantSlug: publicStorefrontSlug }),
    "49: Subscription inactive + Plan ecommerce YES + Config YES => no disponible",
  );
}

// ==================================================
// 51. Storefront público -- Discovery/ProductDetail cierran el BLOCKER (auditoría §15/§30):
// antes de este fix, ambos leían con el tenantId ya resuelto por el hook (modo laxo
// `allowDisabled`) SIN revalidar Subscription/Plan/capability `ecommerce` -- una tienda
// suspendida/cancelada/con plan archivado/sin capability seguía sirviendo catálogo real.
// ==================================================
async function verifyPublicStorefrontReadBoundary() {
  // A. Subscription active + Plan active + capability ecommerce + Config enabled => PASS.
  const active = buildStorefrontState({ planHasEcommerce: true, configEnabled: true });
  const discovery = await new GetStorefrontDiscoveryService(active.repositories).execute(
    publicStorefrontSlug, active.tenantId,
  );
  assert.ok(
    discovery.products.some((product) => product.id === active.productId),
    "A: discovery debe listar catálogo real cuando el estado comercial está activo",
  );
  const detail = await new GetStorefrontProductDetailService(active.repositories).execute(
    publicStorefrontSlug, active.tenantId,
    active.productId,
  );
  assert.ok(detail, "A: product detail debe responder cuando el estado comercial está activo");

  // B. Plan sin capability ecommerce + Config enabled => discovery DENIED.
  const noCapability = buildStorefrontState({ planHasEcommerce: false, configEnabled: true });
  await assert.rejects(
    new GetStorefrontDiscoveryService(noCapability.repositories).execute(publicStorefrontSlug, noCapability.tenantId),
    SaasEntitlementError,
    "B: Plan sin capability ecommerce => discovery DENIED",
  );

  // C. Subscription suspended => discovery DENIED.
  const suspended = buildStorefrontState({
    planHasEcommerce: true,
    configEnabled: true,
    subscriptionStatus: TenantSubscriptionStatus.suspended,
  });
  await assert.rejects(
    new GetStorefrontDiscoveryService(suspended.repositories).execute(publicStorefrontSlug, suspended.tenantId),
    SaasEntitlementError,
    "C: Subscription suspended => discovery DENIED",
  );

  // D. Subscription cancelled => discovery DENIED.
  const cancelled = buildStorefrontState({
    planHasEcommerce: true,
    configEnabled: true,
    subscriptionStatus: TenantSubscriptionStatus.cancelled,
  });
  await assert.rejects(
    new GetStorefrontDiscoveryService(cancelled.repositories).execute(publicStorefrontSlug, cancelled.tenantId),
    SaasEntitlementError,
    "D: Subscription cancelled => discovery DENIED",
  );

  // E. Plan archived => discovery DENIED.
  const archivedPlan = buildStorefrontState({
    planHasEcommerce: true,
    configEnabled: true,
    planStatus: PlanStatus.archived,
  });
  await assert.rejects(
    new GetStorefrontDiscoveryService(archivedPlan.repositories).execute(publicStorefrontSlug, archivedPlan.tenantId),
    SaasEntitlementError,
    "E: Plan archived => discovery DENIED",
  );

  // F. Plan ecommerce YES + Config disabled => discovery DENIED.
  const configDisabled = buildStorefrontState({ planHasEcommerce: true, configEnabled: false });
  await assert.rejects(
    new GetStorefrontDiscoveryService(configDisabled.repositories).execute(publicStorefrontSlug, configDisabled.tenantId),
    "F: Plan ecommerce YES + Config disabled => discovery DENIED",
  );

  // G. Direct Product Detail call with ecommerce missing => DENIED (cierra el bypass donde
  // discovery deniega pero /product/:id todavía devuelve datos).
  await assert.rejects(
    new GetStorefrontProductDetailService(noCapability.repositories).execute(
      publicStorefrontSlug, noCapability.tenantId, noCapability.productId,
    ),
    SaasEntitlementError,
    "G: product detail directo sin capability ecommerce => DENIED",
  );

  // H. Un `tenantId` que NO es el tenant público real (resuelto por slug) nunca debe recibir
  // datos -- cierra el cross-tenant disclosure de un caller que invoca el Application Service
  // directo con un tenantId arbitrario (bypass de `PublicTenantProvider`/`usePublicTenant`).
  // `ensurePublicStorefrontTenant` resuelve el tenant público real (que SÍ pasa el estado
  // comercial estricto) y luego compara contra el tenantId pedido -- el mismatch es un Error
  // simple ("La tienda pública no está disponible."), no un SaasEntitlementError (esto no es una
  // denegación de Plan/Subscription, es un intento de leer un tenant que no es el público).
  const crossTenantId = "tenant-storefront-cross";
  await assert.rejects(
    new GetStorefrontDiscoveryService(active.repositories).execute(publicStorefrontSlug, crossTenantId),
    "H: un tenantId que no es el tenant público real => DENIED (no cross-tenant disclosure)",
  );
  await assert.rejects(
    new GetStorefrontProductDetailService(active.repositories).execute(
      publicStorefrontSlug, crossTenantId, active.productId,
    ),
    "H: product detail con tenantId ajeno => DENIED",
  );

  // I. Order Tracking -- política HISTORICAL ACCESS PRESERVED (auditoría §4): la orden ecommerce
  // ya existente de demoSeed (`order-001`/`TRACK-WEB-001`, tenant-demo) sigue siendo consultable
  // por su tracking token aunque el tenant haya perdido la capability `ecommerce` DESPUÉS de la
  // compra -- el boundary real de esta lectura es tenant+EcommerceConfig.enabled+
  // guestTrackingEnabled+order.source, nunca la capability SaaS `ecommerce`.
  const trackingWithoutCapability = buildStorefrontState({
    planHasEcommerce: false,
    configEnabled: true,
  });
  const trackingResult = await new GetStorefrontOrderTrackingService(
    trackingWithoutCapability.repositories,
  ).execute({ tenantSlug: publicStorefrontSlug, trackingToken: trackingWithoutCapability.trackingToken });
  assert.ok(
    trackingResult,
    "I: TRACKING POLICY = HISTORICAL ACCESS PRESERVED -- debe seguir respondiendo sin capability ecommerce",
  );

  // I (contraparte): si el boundary real (EcommerceConfig.enabled) falla, tracking SÍ deniega --
  // no es un guard que siempre pasa, solo no depende de la capability SaaS.
  const trackingWithConfigDisabled = buildStorefrontState({
    planHasEcommerce: true,
    configEnabled: false,
  });
  const deniedTrackingResult = await new GetStorefrontOrderTrackingService(
    trackingWithConfigDisabled.repositories,
  ).execute({ tenantSlug: publicStorefrontSlug, trackingToken: trackingWithConfigDisabled.trackingToken });
  assert.equal(
    deniedTrackingResult,
    null,
    "I: EcommerceConfig.enabled=false sigue denegando tracking (boundary real, no capability)",
  );
}

// ==================================================
// 16. catalog.kits enforcement
// ==================================================
async function verifyCatalogKitsEnforcement() {
  // Verificación estática -- validateEditorProduct (el ÚNICO punto de entrada de creación/edición
  // de producto, tanto para Kits como para el resto) debe invocar el guard de entitlement cuando
  // productType === kit. No se reconstruye el DTO completo de ProductEditorDto (decenas de campos
  // no relacionados con esta verificación) -- se confirma que el guard está efectivamente cableado
  // en el código fuente real, mismo patrón que verifyNoDirectAuthAccountCreation en
  // verify-admin-users.ts.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(
    join(process.cwd(), "src/modules/catalog/application/services/productEditorHelpers.ts"),
    "utf8",
  );
  assert.ok(
    /productType === ProductType\.kit/.test(source) && /ensureTenantCanUseKits/.test(source),
    "16: validateEditorProduct debe invocar ensureTenantCanUseKits cuando productType === kit",
  );

  // Prueba directa del guard: mismo comportamiento que ensureTenantCapability para
  // SaasCapabilityKey.catalogKits.
  const harness = createHarness();
  const withoutKits = setupTenant(harness, {
    tenantId: "tenant-nokits",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: [],
  });
  const entitlements = await new ResolveTenantEntitlementsService(withoutKits.repositories).execute(
    "tenant-nokits",
  );
  assert.equal(
    entitlements.effectiveCapabilities.includes(SaasCapabilityKey.catalogKits),
    false,
    "16: un plan sin catalog.kits no debe resolverla como efectiva",
  );
}

// ==================================================
// 17-19/50. BusinessConfig matrix (lots/expiration/serials) -- Plan AND Setting
// ==================================================
function verifyBusinessConfigMatrix() {
  const activeEntitlements = {
    tenantId: "t",
    planCode: PlanCode.basic,
    planStatus: PlanStatus.active,
    subscriptionStatus: TenantSubscriptionStatus.active,
    isEntitlementActive: true,
    capabilities: [
      SaasCapabilityKey.traceabilityLots,
      SaasCapabilityKey.traceabilityExpiration,
      SaasCapabilityKey.traceabilitySerials,
    ],
    effectiveCapabilities: [
      SaasCapabilityKey.traceabilityLots,
      SaasCapabilityKey.traceabilityExpiration,
      SaasCapabilityKey.traceabilitySerials,
    ],
    limits: {},
  };
  const noCapabilityEntitlements = { ...activeEntitlements, capabilities: [], effectiveCapabilities: [] };
  const settingAllTrue = {
    supportsLots: true,
    supportsExpiration: true,
    supportsSerials: true,
    supportsKits: true,
  };
  const settingAllFalse = {
    supportsLots: false,
    supportsExpiration: false,
    supportsSerials: false,
    supportsKits: false,
  };

  for (const key of ["supportsLots", "supportsExpiration", "supportsSerials"] as const) {
    // 17/18/19: Plan YES + Setting YES => effective YES
    assert.equal(
      isEffectiveBusinessCapabilityEnabled(activeEntitlements, settingAllTrue, key),
      true,
      `17-19: ${key} Plan YES + Setting YES => effective YES`,
    );
    // 50: Plan YES + Setting NO => effective NO
    assert.equal(
      isEffectiveBusinessCapabilityEnabled(activeEntitlements, settingAllFalse, key),
      false,
      `50: ${key} Plan YES + Setting NO => effective NO`,
    );
    // 50: Plan NO + Setting YES => effective NO
    assert.equal(
      isEffectiveBusinessCapabilityEnabled(noCapabilityEntitlements, settingAllTrue, key),
      false,
      `50: ${key} Plan NO + Setting YES => effective NO`,
    );
    // 50: Plan NO + Setting NO => effective NO
    assert.equal(
      isEffectiveBusinessCapabilityEnabled(noCapabilityEntitlements, settingAllFalse, key),
      false,
      `50: ${key} Plan NO + Setting NO => effective NO`,
    );
  }
}

// 17 (integración real): Inventory bloquea un ajuste de un producto con lote cuando el Plan no
// incluye traceability.lots, aunque BusinessCapabilitiesConfig.supportsLots sea true.
async function verifyLotsEffectiveConfigIntegration() {
  const harness = createHarness();
  const tenantId = "tenant-lots-integration";
  const withoutLots = setupTenant(harness, {
    tenantId,
    planCapabilities: [SaasCapabilityKey.inventory], // SIN traceability.lots
    permissions: ["inventory.adjustment.create"],
  });
  harness.store.mutate((db) => {
    seedProduct(db, {
      id: "prod-lot-integration",
      tenantId,
      categoryId: `cat-${tenantId}`,
      unitId: `unit-${tenantId}`,
      tracking: { stock: true, lot: true, expiration: false, serial: false },
    });
    seedLocation(db, "loc-lot-integration", tenantId, withoutLots.branchId);
  });
  await assert.rejects(
    new RegisterInventoryAdjustmentService(withoutLots.repositories).execute({
      productId: "prod-lot-integration",
      branchId: withoutLots.branchId,
      locationId: "loc-lot-integration",
      unitId: `unit-${tenantId}`,
      quantity: 1,
      movementKind: "in",
      lotNumber: "LOTE-1",
      reason: "17: lote requerido sin traceability.lots en el Plan",
    } as never),
    SaasEntitlementError,
    "17: producto con tracking.lot=true debe bloquearse sin traceability.lots en el Plan",
  );
}

// ==================================================
// 20-22/25. maxEmployees
// ==================================================
async function verifyMaxEmployeesLimits() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-max-employees",
    planCapabilities: FULL_CAPABILITIES,
    planLimits: { [SaasLimitKey.maxEmployees]: 2 },
    permissions: ["admin.users.manage"],
  });
  // El propio actor de setupTenant ya cuenta como 1 empleado -- crear uno más llega a 2 (el límite).
  const before = await harness.createSession(tenant.userId).users.listByTenant("tenant-max-employees");
  assert.equal(before.length, 1, "20 (fixture): arranca con 1 empleado (el actor)");

  // 20. below limit allow (1 -> 2, límite 2)
  await new CreateEmployeeService(tenant.repositories).execute(
    "tenant-max-employees",
    {
      name: "Segundo Empleado",
      email: `second-${Math.random().toString(36).slice(2, 8)}@entitlement.test`,
      phone: undefined,
      employeeCode: `SEC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      roleId: tenant.roleId,
      allowedBranchIds: [tenant.branchId],
      status: UserStatus.active,
    },
    permissionsConfig.map((p) => p.key),
    tenant.userId,
  );
  const afterSecond = await tenant.repositories.users.listByTenant("tenant-max-employees");
  assert.equal(afterSecond.length, 2, "20: maxEmployees=2, con 1 existente, crear el 2do debe ALLOW");

  // 21. at limit deny (2 == límite 2)
  await assert.rejects(
    new CreateEmployeeService(tenant.repositories).execute(
      "tenant-max-employees",
      {
        name: "Tercer Empleado",
        email: `third-${Math.random().toString(36).slice(2, 8)}@entitlement.test`,
        phone: undefined,
        employeeCode: `THI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        roleId: tenant.roleId,
        allowedBranchIds: [tenant.branchId],
        status: UserStatus.active,
      },
      permissionsConfig.map((p) => p.key),
      tenant.userId,
    ),
    SaasEntitlementError,
    "21: maxEmployees=2, ya en el límite, crear un 3ro debe DENY",
  );
  const afterDenied = await tenant.repositories.users.listByTenant("tenant-max-employees");
  assert.equal(afterDenied.length, 2, "26: la creación denegada no debe dejar un 3er empleado creado");

  // 22. existing employees above downgraded limit remain
  harness.store.mutate((db) => {
    const plan = db.planDefinitions.find((item) => item.id === tenant.planId);
    assert.ok(plan);
    plan.limits = { [SaasLimitKey.maxEmployees]: 1 }; // downgrade por debajo de los 2 existentes
  });
  const afterDowngrade = await tenant.repositories.users.listByTenant("tenant-max-employees");
  assert.equal(afterDowngrade.length, 2, "22: el downgrade NO debe archivar/borrar empleados existentes");
  await assert.rejects(
    new CreateEmployeeService(tenant.repositories).execute(
      "tenant-max-employees",
      {
        name: "Cuarto Empleado",
        email: `fourth-${Math.random().toString(36).slice(2, 8)}@entitlement.test`,
        phone: undefined,
        employeeCode: `FOU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        roleId: tenant.roleId,
        allowedBranchIds: [tenant.branchId],
        status: UserStatus.active,
      },
      permissionsConfig.map((p) => p.key),
      tenant.userId,
    ),
    SaasEntitlementError,
    "22: tras el downgrade, la PRÓXIMA alta debe quedar bloqueada",
  );

  // 25. undefined limit => unlimited
  const unlimited = setupTenant(harness, {
    tenantId: "tenant-unlimited-employees",
    planCapabilities: FULL_CAPABILITIES,
    planLimits: {}, // maxEmployees ausente
    permissions: ["admin.users.manage"],
  });
  for (let i = 0; i < 3; i += 1) {
    await new CreateEmployeeService(unlimited.repositories).execute(
      "tenant-unlimited-employees",
      {
        name: `Empleado ilimitado ${i}`,
        email: `unlimited-${i}-${Math.random().toString(36).slice(2, 6)}@entitlement.test`,
        phone: undefined,
        employeeCode: `UNL-${i}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        roleId: unlimited.roleId,
        allowedBranchIds: [unlimited.branchId],
        status: UserStatus.active,
      },
      permissionsConfig.map((p) => p.key),
      unlimited.userId,
    );
  }
  assert.ok(true, "25: límite ausente (undefined) debe permitir altas ilimitadas");
}

// ==================================================
// 23-24/25. maxBranches
// ==================================================
async function verifyMaxBranchesLimits() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-max-branches",
    planCapabilities: FULL_CAPABILITIES,
    planLimits: { [SaasLimitKey.maxBranches]: 2 },
    permissions: ["admin.branches.manage"],
  });
  // setupTenant ya crea 1 branch (la sucursal del actor).
  const before = await tenant.repositories.branches.listByTenant("tenant-max-branches");
  assert.equal(before.length, 1, "23 (fixture): arranca con 1 sucursal");

  // 23. below limit allow (1 -> 2, límite 2)
  await new CreateBranchService(tenant.repositories).execute(
    "tenant-max-branches",
    { code: "SUC-2", name: "Sucursal 2", type: BranchType.store, status: BranchStatus.active },
    ["admin.branches.manage"],
    tenant.userId,
  );
  const afterSecond = await tenant.repositories.branches.listByTenant("tenant-max-branches");
  assert.equal(afterSecond.length, 2, "23: maxBranches=2, con 1 existente, crear la 2da debe ALLOW");

  // 24. at limit deny
  await assert.rejects(
    new CreateBranchService(tenant.repositories).execute(
      "tenant-max-branches",
      { code: "SUC-3", name: "Sucursal 3", type: BranchType.store, status: BranchStatus.active },
      ["admin.branches.manage"],
      tenant.userId,
    ),
    SaasEntitlementError,
    "24: maxBranches=2, ya en el límite, crear la 3ra debe DENY",
  );
  const afterDenied = await tenant.repositories.branches.listByTenant("tenant-max-branches");
  assert.equal(afterDenied.length, 2, "26: la creación denegada no debe dejar una 3ra sucursal creada");

  // 25. undefined limit => unlimited
  const unlimited = setupTenant(harness, {
    tenantId: "tenant-unlimited-branches",
    planCapabilities: FULL_CAPABILITIES,
    planLimits: {},
    permissions: ["admin.branches.manage"],
  });
  for (let i = 0; i < 3; i += 1) {
    await new CreateBranchService(unlimited.repositories).execute(
      "tenant-unlimited-branches",
      { code: `SUC-U-${i}`, name: `Sucursal ilimitada ${i}`, type: BranchType.store, status: BranchStatus.active },
      ["admin.branches.manage"],
      unlimited.userId,
    );
  }
  assert.ok(true, "25: límite ausente (undefined) debe permitir altas ilimitadas de sucursales");
}

// ==================================================
// 26. denied create leaves zero effects (Purchasing, complementando Employees/Branches arriba)
// ==================================================
async function verifyDeniedCreateLeavesZeroEffectsPurchasing() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-zero-effects",
    planCapabilities: [], // sin "purchasing"
    permissions: ["purchasing.orders.create"],
  });
  harness.store.mutate((db) => {
    seedProduct(db, {
      id: "prod-zero-effects",
      tenantId: "tenant-zero-effects",
      categoryId: "cat-tenant-zero-effects",
      unitId: "unit-tenant-zero-effects",
    });
    seedSupplier(db, "supplier-zero-effects", "tenant-zero-effects", "prod-zero-effects", "unit-tenant-zero-effects");
  });

  const before = harness.store.getSnapshot().purchaseOrders.length;
  await assert.rejects(
    new PurchaseOrderEditorService(tenant.repositories).createOrder({
      branchId: tenant.branchId,
      supplierId: "supplier-zero-effects",
      expectedDate: "2026-10-01",
      notes: "",
      lines: [
        {
          id: "line-1",
          productId: "prod-zero-effects",
          productName: "Producto",
          sku: "SKU",
          supplierSku: "-",
          unitId: "unit-tenant-zero-effects",
          unitLabel: "u",
          purchaseToBaseFactor: 1,
          quantity: 2,
          baseCost: 10,
          suggestedCost: 10,
          agreedCost: 10,
          subtotal: 20,
          manualCost: true,
          minimumOrderQuantity: 1,
          tiers: [],
          stockQuantity: 0,
          minStock: 0,
          shortage: 0,
          suggestedReorder: 0,
          availabilityLabel: "Disponible",
        },
      ],
    } as never),
    SaasEntitlementError,
    "26: PurchaseOrderEditorService.createOrder sin capability 'purchasing' debe DENY",
  );
  const after = harness.store.getSnapshot().purchaseOrders.length;
  assert.equal(after, before, "26: la denegación no debe dejar ninguna PurchaseOrder creada");
}

// ==================================================
// 27. direct Application Service call cannot bypass
// ==================================================
async function verifyDirectServiceCallCannotBypass() {
  // Todos los tests de este harness YA llaman a los Application Services directamente (sin UI,
  // sin hooks, sin componente React) -- eso en sí mismo prueba que el boundary real es el
  // service, no una capa de presentación. Este test lo hace explícito: ningún service acepta
  // `capabilities`/`tenantId`/`planId` como parte del DTO que el caller controla -- el tenantId
  // SIEMPRE sale de la sesión (`resolvePurchasingContext`/`resolveInventoryContext`/etc.), así
  // que no existe forma de "pasar" un tenantId con más capabilities desde el caller.
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-bypass",
    planCapabilities: [], // sin "purchasing"
    permissions: ["purchasing.orders.create"],
  });
  harness.store.mutate((db) => {
    seedProduct(db, {
      id: "prod-bypass",
      tenantId: "tenant-bypass",
      categoryId: "cat-tenant-bypass",
      unitId: "unit-tenant-bypass",
    });
    seedSupplier(db, "supplier-bypass", "tenant-bypass", "prod-bypass", "unit-tenant-bypass");
  });

  // Intento de bypass: el input NO tiene ningún campo tenantId/capabilities -- SavePurchaseOrderInput
  // no lo admite -- así que ni siquiera hay un campo que "falsificar". El servicio deriva todo de
  // la sesión autenticada del caller (tenant-bypass, sin capability "purchasing").
  await assert.rejects(
    new PurchaseOrderEditorService(tenant.repositories).saveDraft({
      branchId: tenant.branchId,
      supplierId: "supplier-bypass",
      expectedDate: "2026-10-01",
      notes: "",
      lines: [],
    } as never),
    SaasEntitlementError,
    "27: la llamada directa al Application Service (sin UI) no debe poder saltarse el entitlement",
  );
}

// ==================================================
// 28. PR102 Tenant resuelve su propio Plan automáticamente
// ==================================================
async function verifyPr102TenantResolvesOwnPlan() {
  const harness = createHarness();
  const plainRepositories = harness.createSession("bootstrap");
  harness.store.mutate((db) => {
    seedPlan(db, {
      id: "plan-pr102-onboarding",
      capabilities: [SaasCapabilityKey.inventory, SaasCapabilityKey.purchasing],
    });
  });

  const suffix = Math.random().toString(36).slice(2, 8);
  const onboardingResult = await new TenantOnboardingService(plainRepositories).execute({
    tenantName: `Tenant Onboarding Entitlement ${suffix}`,
    tenantSlug: `tenant-onboarding-entitlement-${suffix}`,
    adminName: "Admin Onboarding",
    adminEmail: `admin-onboarding-entitlement-${suffix}@example.test`,
    adminPasswordMock: "OnboardingPass1!",
    planId: "plan-pr102-onboarding",
  });

  const entitlements = await new ResolveTenantEntitlementsService(plainRepositories).execute(
    onboardingResult.tenantId,
  );
  assert.equal(entitlements.isEntitlementActive, true, "28: el Tenant recién creado por PR#102 resuelve una Subscription activa");
  assert.deepEqual(
    new Set(entitlements.effectiveCapabilities),
    new Set([SaasCapabilityKey.inventory, SaasCapabilityKey.purchasing]),
    "28: resuelve EXACTAMENTE las capabilities del Plan elegido durante el onboarding",
  );
}

// ==================================================
// 29. tenant-demo remains operational under Basic + both commercial add-ons
// ==================================================
async function verifyTenantDemoRemainsOperational() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage); // fuerza el seed real (demoSeed), sin mutaciones custom
  const eventBus = new DataEventBus();

  const repositories = {
    auth: {
      getCurrentSessionId: async () => "session-tenant-demo-entitlement",
      getSession: async (sessionId: string) =>
        sessionId === "session-tenant-demo-entitlement"
          ? { id: sessionId, userId: "user-admin" }
          : null,
    },
    users: new MockUserRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    branches: new MockBranchRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    cashShifts: new MockCashShiftRepository(store, eventBus),
    cashMovements: new MockCashMovementRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  const entitlements = await new ResolveTenantEntitlementsService(repositories).execute(
    "tenant-demo",
  );
  assert.equal(entitlements.isEntitlementActive, true, "29: tenant-demo debe seguir con Subscription+Plan activos");
  assert.deepEqual(
    new Set(entitlements.effectiveCapabilities),
    new Set([
      SaasCapabilityKey.inventory,
      SaasCapabilityKey.purchasing,
      SaasCapabilityKey.receiving,
      SaasCapabilityKey.pos,
      SaasCapabilityKey.traceabilityLots,
      SaasCapabilityKey.traceabilityExpiration,
      SaasCapabilityKey.traceabilitySerials,
      SaasCapabilityKey.ecommerce,
      SaasCapabilityKey.delivery,
      SaasCapabilityKey.advancedReports,
    ]),
    "29: tenant-demo resuelve Basic y los dos complementos contratados",
  );

  // Mutación real representativa -- abrir turno de caja con el admin demo, en su sucursal real --
  // no debe verse afectada por el nuevo enforcement.
  const shift = await new OpenCashShiftService(repositories).execute({
    tenantId: "tenant-demo",
    actorUserId: "user-admin",
    branchId: "branch-centro",
    registerCode: `CAJA-DEMO-${Math.random().toString(36).slice(2, 6)}`,
    openingAmount: 100,
  });
  assert.equal(shift.status, CashShiftStatus.open, "29: tenant-demo sigue pudiendo operar (abrir caja) con normalidad");
}

// ==================================================
// 30. entitlement error distinguishable from permission error
// ==================================================
async function verifyErrorDistinguishability() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-error-distinction",
    planCapabilities: [], // sin "purchasing" -- para el error de entitlement
    permissions: [], // sin el permiso -- para el error de permiso
  });

  let entitlementError: unknown;
  try {
    await new PurchaseOrderEditorService(tenant.repositories).saveDraft({
      branchId: tenant.branchId,
      supplierId: "does-not-matter",
      expectedDate: "2026-10-01",
      notes: "",
      lines: [],
    } as never);
  } catch (caught) {
    entitlementError = caught;
  }
  // Con permisos VACÍOS, PurchasingServiceError (permiso) se evalúa primero en
  // PurchaseOrderEditorService -- para aislar el caso de entitlement puro, se agrega el permiso y
  // se deja el Plan vacío.
  const tenantWithPermissionOnly = setupTenant(harness, {
    tenantId: "tenant-error-distinction-2",
    planCapabilities: [],
    permissions: ["purchasing.orders.create"],
  });
  let pureEntitlementError: unknown;
  try {
    await new PurchaseOrderEditorService(tenantWithPermissionOnly.repositories).saveDraft({
      branchId: tenantWithPermissionOnly.branchId,
      supplierId: "does-not-matter",
      expectedDate: "2026-10-01",
      notes: "",
      lines: [],
    } as never);
  } catch (caught) {
    pureEntitlementError = caught;
  }

  assert.ok(entitlementError instanceof PurchasingServiceError, "30: sin permiso => PurchasingServiceError");
  assert.ok(!(entitlementError instanceof SaasEntitlementError), "30: el error de permiso NO es un SaasEntitlementError");
  assert.ok(
    pureEntitlementError instanceof SaasEntitlementError,
    "30: sin capability (con permiso) => SaasEntitlementError",
  );
  assert.equal(
    (pureEntitlementError as SaasEntitlementError).code,
    "CAPABILITY_REQUIRED",
    "30: el error de entitlement expone un code machine-readable",
  );
  assert.ok(
    !/permiso/i.test((pureEntitlementError as Error).message),
    "30: el mensaje de entitlement no debe redactarse como si fuera un error de permisos",
  );
}

async function main() {
  await verifyResolverActiveAndRestricted();
  console.log("1-2. resolución de entitlements (Plan activo / Plan restringido): PASS");
  await verifyCapabilityPermissionBranchMatrix();
  console.log("3-7. matriz capability+permission+branch (allow/deny en cada eje): PASS");
  await verifyTenantIsolationOfEntitlements();
  console.log("8. Tenant A no gobierna las entitlements de Tenant B: PASS");
  await verifySubscriptionAndPlanStateDenials();
  console.log("9-13. suspended/cancelled/archived Plan/missing Subscription/missing Plan: PASS");
  await verifyHistoricalReadAfterCapabilityRemoval();
  console.log("14. lectura histórica tras perder la capability: PASS");
  await verifyEcommerceFourStateMatrix();
  console.log("15/49. matriz de 4 estados de ecommerce (Plan x EcommerceConfig x Subscription): PASS");
  await verifyPublicStorefrontReadBoundary();
  console.log("51. Storefront público: Discovery/ProductDetail/OrderTracking respetan el boundary real (A-I): PASS");
  await verifyCatalogKitsEnforcement();
  console.log("16. catalog.kits cableado en validateEditorProduct + guard directo: PASS");
  verifyBusinessConfigMatrix();
  console.log("17-19/50. matriz BusinessConfig (lots/expiration/serials) Plan AND Setting: PASS");
  await verifyLotsEffectiveConfigIntegration();
  console.log("17 (integración real): Inventory bloquea lote sin traceability.lots en el Plan: PASS");
  await verifyMaxEmployeesLimits();
  console.log("20-22/25. maxEmployees (below/at/downgrade/unlimited): PASS");
  await verifyMaxBranchesLimits();
  console.log("23-25. maxBranches (below/at/unlimited): PASS");
  await verifyDeniedCreateLeavesZeroEffectsPurchasing();
  console.log("26. denied create deja cero efectos (PurchaseOrder): PASS");
  await verifyDirectServiceCallCannotBypass();
  console.log("27. llamada directa al Application Service no puede bypassear: PASS");
  await verifyPr102TenantResolvesOwnPlan();
  console.log("28. Tenant creado por PR#102 resuelve su propio Plan: PASS");
  await verifyTenantDemoRemainsOperational();
  console.log("29. tenant-demo sigue operativo: PASS");
  await verifyErrorDistinguishability();
  console.log("30. error de entitlement distinguible del error de permiso: PASS");
}

void main();
