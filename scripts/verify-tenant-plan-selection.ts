/**
 * Harness de regresión para feature/tenant-plan-selection.
 *
 * Uso (desde la raíz del proyecto):
 *   npx tsx scripts/verify-tenant-plan-selection.ts
 *
 * Mismo patrón que scripts/verify-saas-entitlement-enforcement.ts (`createHarness()` +
 * `setupTenant()`, fixture aislada, sin tocar `demoSeed.ts`): un store en memoria propio, tenants/
 * planes/suscripciones armados on-demand. A diferencia de ese harness, acá SÍ se usa un
 * `MockAuditLogRepository` real (no el stub no-op) porque el escenario de auditoría necesita
 * poder leer lo que `ChangeTenantPlanService` efectivamente escribió.
 *
 * Cubre las 8 áreas de la spec (permission gating, guard order, side-effect boundaries, audit
 * log, same-tab propagation, picker UI/availablePlans, historical read preservation, cross-tenant
 * isolation) en 15 verificaciones puntuales.
 */
import assert from "node:assert/strict";
import {
  BranchStatus,
  BranchType,
  BusinessPreset,
  PlanCode,
  PlanStatus,
  PurchaseOrderStatus,
  RoleStatus,
  SaasCapabilityKey,
  SaasLimitKey,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockAuditLogRepository,
  MockAuthRepository,
  MockBranchRepository,
  MockPlanRepository,
  MockProductRepository,
  MockPurchaseOrderRepository,
  MockReceiptRepository,
  MockRoleRepository,
  MockSupplierRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { ChangeTenantPlanService } from "@/modules/administration/application/services/ChangeTenantPlanService";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import { GetPurchaseOrdersReadModelService } from "@/modules/purchasing/application/services/GetPurchaseOrdersReadModelService";

const NOW = "2026-09-16T12:00:00.000Z";

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
// Fixture builders (mismo estilo que verify-saas-entitlement-enforcement.ts)
// ==================================================

function seedTenant(db: MockDatabase, id: string) {
  db.tenants.push({
    id,
    name: `Tenant fixture ${id}`,
    slug: id,
    status: TenantStatus.active,
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
    code?: PlanCode;
    name?: string;
    description?: string;
    capabilities: SaasCapabilityKey[];
    limits?: Partial<Record<SaasLimitKey, number>>;
    status?: PlanStatus;
  },
) {
  db.planDefinitions.push({
    id: input.id,
    code: input.code ?? PlanCode.basic,
    name: input.name ?? `Plan fixture ${input.id}`,
    description: input.description,
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

function seedBusinessCapabilities(db: MockDatabase, tenantId: string) {
  db.businessCapabilities.push({
    tenantId,
    preset: BusinessPreset.custom,
    supportsInventory: true,
    supportsLots: true,
    supportsExpiration: false,
    supportsSerials: false,
    supportsMultipleLocations: false,
    supportsUnitsAndPackaging: true,
    supportsProductAttributes: false,
    supportsKits: false,
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
  input: { id: string; tenantId: string; roleId: string; branchId: string },
) {
  db.users.push({
    id: input.id,
    tenantId: input.tenantId,
    name: `User fixture ${input.id}`,
    email: `${input.id}@plan-selection.test`,
    type: UserType.employee,
    status: UserStatus.active,
    roleId: input.roleId,
    branchId: input.branchId,
    allowedBranchIds: [input.branchId],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedPurchaseOrder(
  db: MockDatabase,
  input: { id: string; tenantId: string; branchId: string; createdByUserId: string },
) {
  db.purchaseOrders.push({
    id: input.id,
    tenantId: input.tenantId,
    branchId: input.branchId,
    number: `PO-${input.id}`,
    supplierId: "supplier-history-fixture",
    status: PurchaseOrderStatus.received,
    subtotal: 0,
    total: 0,
    createdByUserId: input.createdByUserId,
    items: [],
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
 * `createSession`. Mismo patrón que `scripts/verify-saas-entitlement-enforcement.ts:334-392` --
 * `auth` real envuelto en un Proxy que fija la sesión sintética, todo lo demás delega a la
 * implementación real. `auditLogs` usa el `MockAuditLogRepository` real (no un stub no-op): el
 * escenario de auditoría necesita poder leer lo que el service realmente escribió.
 */
function createHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();

  function buildRepositories(session: Session): RepositoryRegistry {
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
      branches: new MockBranchRepository(store, eventBus),
      plans: new MockPlanRepository(store, eventBus),
      tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
      auditLogs: new MockAuditLogRepository(store, eventBus),
      suppliers: new MockSupplierRepository(store, eventBus),
      products: new MockProductRepository(store, eventBus),
      units: new MockUnitRepository(store, eventBus),
      receipts: new MockReceiptRepository(store, eventBus),
      purchaseOrders: new MockPurchaseOrderRepository(store, eventBus),
    } as unknown as RepositoryRegistry;
  }

  function createSession(userId: string): RepositoryRegistry {
    const suffix = Math.random().toString(36).slice(2, 9);
    const sessionId = `session-plan-selection-${suffix}`;
    return buildRepositories({ id: sessionId, userId });
  }

  return { store, eventBus, createSession };
}

/**
 * Arma tenant + branch + role + user + plan + subscription en un solo paso, devolviendo un
 * `RepositoryRegistry` ya autenticado como ese user.
 */
function setupTenant(
  harness: ReturnType<typeof createHarness>,
  input: {
    tenantId: string;
    planCapabilities: SaasCapabilityKey[];
    planLimits?: Partial<Record<SaasLimitKey, number>>;
    subscriptionStatus?: TenantSubscriptionStatus;
    permissions: string[];
  },
) {
  const branchId = `${input.tenantId}-branch`;
  const roleId = `${input.tenantId}-role`;
  const userId = `${input.tenantId}-user`;
  const planId = `${input.tenantId}-plan`;

  harness.store.mutate((db) => {
    seedTenant(db, input.tenantId);
    seedBranch(db, branchId, input.tenantId);
    seedRole(db, roleId, input.tenantId, input.permissions);
    seedUser(db, { id: userId, tenantId: input.tenantId, roleId, branchId });
    seedBusinessCapabilities(db, input.tenantId);
    seedPlan(db, { id: planId, capabilities: input.planCapabilities, limits: input.planLimits });
    seedSubscription(db, {
      id: `${input.tenantId}-subscription`,
      tenantId: input.tenantId,
      planId,
      status: input.subscriptionStatus,
    });
  });

  const repositories = harness.createSession(userId);
  return { branchId, roleId, userId, planId, repositories };
}

const READ_AND_MANAGE = ["admin.plans.read", "admin.plans.manage"];

// ==================================================
// 1-2. Permission gating
// ==================================================
async function verifyPermissionGating() {
  const harness = createHarness();

  // 1. read pero no manage -> execute() rechazado por ensureCanManagePlans.
  const readOnly = setupTenant(harness, {
    tenantId: "tenant-plan-readonly",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: ["admin.plans.read"],
  });
  harness.store.mutate((db) => {
    seedPlan(db, { id: "plan-readonly-target", capabilities: [SaasCapabilityKey.pos] });
  });
  await assert.rejects(
    new ChangeTenantPlanService(readOnly.repositories).execute(
      "tenant-plan-readonly",
      "plan-readonly-target",
      ["admin.plans.read"],
      readOnly.userId,
    ),
    AdministrationServiceError,
    "1: read sin manage debe rechazar el cambio directo",
  );

  // 2. ninguno de los dos permisos -> tanto la lectura como el cambio se rechazan.
  const neither = setupTenant(harness, {
    tenantId: "tenant-plan-neither",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: [],
  });
  await assert.rejects(
    new GetTenantSubscriptionDetailsService(neither.repositories).execute(
      "tenant-plan-neither",
      [],
    ),
    AdministrationServiceError,
    "2a: sin admin.plans.read la lectura debe rechazarse",
  );
  await assert.rejects(
    new ChangeTenantPlanService(neither.repositories).execute(
      "tenant-plan-neither",
      "plan-readonly-target",
      [],
      neither.userId,
    ),
    AdministrationServiceError,
    "2b: sin ningún permiso el cambio directo debe rechazarse",
  );
}

// ==================================================
// 3-6. Guard order and outcomes
// ==================================================
async function verifyGuardOrderAndOutcomes() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-plan-guards",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: READ_AND_MANAGE,
  });
  let archivedPlanId = "";
  harness.store.mutate((db) => {
    archivedPlanId = "plan-guards-archived";
    seedPlan(db, {
      id: archivedPlanId,
      capabilities: [SaasCapabilityKey.pos],
      status: PlanStatus.archived,
    });
  });

  // 3. plan destino inexistente.
  await assert.rejects(
    new ChangeTenantPlanService(tenant.repositories).execute(
      "tenant-plan-guards",
      "plan-does-not-exist",
      READ_AND_MANAGE,
      tenant.userId,
    ),
    AdministrationServiceError,
    "3: targetPlanId inexistente debe rechazarse",
  );

  // 4. plan destino archivado.
  await assert.rejects(
    new ChangeTenantPlanService(tenant.repositories).execute(
      "tenant-plan-guards",
      archivedPlanId,
      READ_AND_MANAGE,
      tenant.userId,
    ),
    AdministrationServiceError,
    "4: targetPlanId archivado debe rechazarse",
  );

  // 5. mismo plan -> no-op: sin write, sin AuditLog, sin evento.
  let emittedCount = 0;
  const unsubscribe = harness.eventBus.subscribe("tenant-subscription.changed", () => {
    emittedCount += 1;
  });
  const before = await tenant.repositories.tenantSubscriptions.getByTenantId("tenant-plan-guards");
  const auditBefore = await tenant.repositories.auditLogs.getByTenant("tenant-plan-guards");
  const result = await new ChangeTenantPlanService(tenant.repositories).execute(
    "tenant-plan-guards",
    tenant.planId,
    READ_AND_MANAGE,
    tenant.userId,
  );
  const after = await tenant.repositories.tenantSubscriptions.getByTenantId("tenant-plan-guards");
  const auditAfter = await tenant.repositories.auditLogs.getByTenant("tenant-plan-guards");
  assert.equal(result.plan.id, tenant.planId, "5: no-op debe devolver el plan vigente");
  assert.deepEqual(after, before, "5: no-op no debe mutar la Subscription (ni updatedAt)");
  assert.equal(auditAfter.length, auditBefore.length, "5: no-op no debe agregar AuditLog");
  assert.equal(emittedCount, 0, "5: no-op no debe emitir tenant-subscription.changed");
  unsubscribe();

  // 6. subscription suspendida no debe bloquear el cambio.
  const suspended = setupTenant(harness, {
    tenantId: "tenant-plan-suspended",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: READ_AND_MANAGE,
    subscriptionStatus: TenantSubscriptionStatus.suspended,
  });
  let suspendedTargetId = "";
  harness.store.mutate((db) => {
    suspendedTargetId = "plan-suspended-target";
    seedPlan(db, { id: suspendedTargetId, capabilities: [SaasCapabilityKey.pos] });
  });
  const suspendedResult = await new ChangeTenantPlanService(suspended.repositories).execute(
    "tenant-plan-suspended",
    suspendedTargetId,
    READ_AND_MANAGE,
    suspended.userId,
  );
  assert.equal(
    suspendedResult.plan.id,
    suspendedTargetId,
    "6: subscription suspended no debe impedir el cambio de plan",
  );
}

// ==================================================
// 7-10. Side-effect boundaries
// ==================================================
async function verifySideEffectBoundaries() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-plan-sideeffects",
    planCapabilities: [SaasCapabilityKey.inventory, SaasCapabilityKey.pos],
    planLimits: { [SaasLimitKey.maxEmployees]: 5, [SaasLimitKey.maxBranches]: 5 },
    permissions: READ_AND_MANAGE,
  });
  // Segundo empleado + segunda sucursal para que el downgrade quede POR DEBAJO del uso actual.
  harness.store.mutate((db) => {
    seedBranch(db, "tenant-plan-sideeffects-branch-2", "tenant-plan-sideeffects");
    seedUser(db, {
      id: "tenant-plan-sideeffects-user-2",
      tenantId: "tenant-plan-sideeffects",
      roleId: tenant.roleId,
      branchId: tenant.branchId,
    });
    seedPlan(db, {
      id: "plan-sideeffects-downgrade",
      capabilities: [SaasCapabilityKey.inventory],
      limits: { [SaasLimitKey.maxEmployees]: 1, [SaasLimitKey.maxBranches]: 1 },
    });
  });

  const usersBefore = await tenant.repositories.users.listByTenant("tenant-plan-sideeffects");
  const branchesBefore = await tenant.repositories.branches.listByTenant("tenant-plan-sideeffects");
  const businessConfigBefore = harness.store.read(
    (db) => db.businessCapabilities.find((item) => item.tenantId === "tenant-plan-sideeffects")!,
  );

  await new ChangeTenantPlanService(tenant.repositories).execute(
    "tenant-plan-sideeffects",
    "plan-sideeffects-downgrade",
    READ_AND_MANAGE,
    tenant.userId,
  );

  const usersAfter = await tenant.repositories.users.listByTenant("tenant-plan-sideeffects");
  const branchesAfter = await tenant.repositories.branches.listByTenant("tenant-plan-sideeffects");
  const businessConfigAfter = harness.store.read(
    (db) => db.businessCapabilities.find((item) => item.tenantId === "tenant-plan-sideeffects")!,
  );

  assert.deepEqual(usersAfter, usersBefore, "7: el downgrade no debe modificar Users existentes");
  assert.deepEqual(
    branchesAfter,
    branchesBefore,
    "8: el downgrade no debe modificar Branches existentes",
  );
  assert.deepEqual(
    businessConfigAfter,
    businessConfigBefore,
    "9: el downgrade no debe mutar BusinessCapabilitiesConfig",
  );
  const subscriptionAfter = await tenant.repositories.tenantSubscriptions.getByTenantId(
    "tenant-plan-sideeffects",
  );
  assert.equal(
    subscriptionAfter?.planId,
    "plan-sideeffects-downgrade",
    "10: el único cambio persistido debe ser planId",
  );
}

// ==================================================
// 11. Audit logging
// ==================================================
async function verifyAuditLogging() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-plan-audit",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: READ_AND_MANAGE,
  });
  let targetPlanId = "";
  harness.store.mutate((db) => {
    targetPlanId = "plan-audit-target";
    seedPlan(db, { id: targetPlanId, code: PlanCode.enterprise, capabilities: [SaasCapabilityKey.pos] });
  });

  await new ChangeTenantPlanService(tenant.repositories).execute(
    "tenant-plan-audit",
    targetPlanId,
    READ_AND_MANAGE,
    tenant.userId,
  );

  const logs = await tenant.repositories.auditLogs.getByTenant("tenant-plan-audit");
  assert.equal(logs.length, 1, "11: debe agregarse exactamente un AuditLog");
  const [log] = logs;
  assert.equal(log.action, "tenant_subscription.plan_changed");
  assert.equal(log.entityType, "TenantSubscription");
  assert.equal(log.actorUserId, tenant.userId);
  assert.deepEqual(log.metadata, {
    previousPlanId: tenant.planId,
    newPlanId: targetPlanId,
    previousPlanCode: PlanCode.basic,
    newPlanCode: PlanCode.enterprise,
  });
}

// ==================================================
// 12. Same-tab event propagation (exactamente una vez)
// ==================================================
async function verifySameTabEventPropagation() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-plan-event",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: READ_AND_MANAGE,
  });
  let targetPlanId = "";
  harness.store.mutate((db) => {
    targetPlanId = "plan-event-target";
    seedPlan(db, { id: targetPlanId, capabilities: [SaasCapabilityKey.pos] });
  });

  const payloads: unknown[] = [];
  const unsubscribe = harness.eventBus.subscribe("tenant-subscription.changed", (payload) => {
    payloads.push(payload);
  });

  await new ChangeTenantPlanService(tenant.repositories).execute(
    "tenant-plan-event",
    targetPlanId,
    READ_AND_MANAGE,
    tenant.userId,
  );

  assert.equal(payloads.length, 1, "12: el cambio exitoso debe emitir exactamente una vez");
  assert.deepEqual(payloads[0], {
    entityId: "tenant-plan-event-subscription",
    tenantId: "tenant-plan-event",
    action: "updated",
  });
  unsubscribe();
}

// ==================================================
// 13. Picker: availablePlans lista solo planes activos
// ==================================================
async function verifyAvailablePlansOnlyActive() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-plan-picker",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: READ_AND_MANAGE,
  });
  harness.store.mutate((db) => {
    seedPlan(db, {
      id: "plan-picker-active",
      name: "Plan Picker Activo",
      description: "Descripción del plan activo",
      capabilities: [SaasCapabilityKey.pos],
    });
    seedPlan(db, {
      id: "plan-picker-archived",
      name: "Plan Picker Archivado",
      capabilities: [SaasCapabilityKey.pos],
      status: PlanStatus.archived,
    });
  });

  const details = await new GetTenantSubscriptionDetailsService(tenant.repositories).execute(
    "tenant-plan-picker",
    READ_AND_MANAGE,
  );

  const ids = details.availablePlans.map((plan) => plan.id);
  assert.ok(ids.includes(tenant.planId), "13: debe incluir el plan vigente");
  assert.ok(ids.includes("plan-picker-active"), "13: debe incluir planes activos adicionales");
  assert.ok(!ids.includes("plan-picker-archived"), "13: NO debe incluir planes archivados");
  const activeEntry = details.availablePlans.find((plan) => plan.id === "plan-picker-active");
  assert.equal(activeEntry?.name, "Plan Picker Activo");
  assert.equal(activeEntry?.description, "Descripción del plan activo");
}

// ==================================================
// 14. Historical read preservation
// ==================================================
async function verifyHistoricalReadPreservation() {
  const harness = createHarness();
  const tenant = setupTenant(harness, {
    tenantId: "tenant-plan-history",
    planCapabilities: [SaasCapabilityKey.purchasing],
    permissions: ["purchasing.orders.read", ...READ_AND_MANAGE],
  });
  harness.store.mutate((db) => {
    seedPurchaseOrder(db, {
      id: "po-history-fixture",
      tenantId: "tenant-plan-history",
      branchId: tenant.branchId,
      createdByUserId: tenant.userId,
    });
    seedPlan(db, { id: "plan-history-nopurchasing", capabilities: [SaasCapabilityKey.pos] });
  });

  await new ChangeTenantPlanService(tenant.repositories).execute(
    "tenant-plan-history",
    "plan-history-nopurchasing",
    READ_AND_MANAGE,
    tenant.userId,
  );

  const readModel = await new GetPurchaseOrdersReadModelService(tenant.repositories).execute();
  assert.ok(
    readModel.orders.some((order) => order.id === "po-history-fixture"),
    "14: la orden histórica debe seguir siendo legible tras perder la capability purchasing",
  );
}

// ==================================================
// 15. Cross-tenant isolation
// ==================================================
async function verifyCrossTenantIsolation() {
  const harness = createHarness();
  const tenantA = setupTenant(harness, {
    tenantId: "tenant-plan-iso-a",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: READ_AND_MANAGE,
  });
  const tenantB = setupTenant(harness, {
    tenantId: "tenant-plan-iso-b",
    planCapabilities: [SaasCapabilityKey.inventory],
    permissions: READ_AND_MANAGE,
  });
  let targetPlanId = "";
  harness.store.mutate((db) => {
    targetPlanId = "plan-iso-target";
    seedPlan(db, { id: targetPlanId, capabilities: [SaasCapabilityKey.pos] });
  });

  const beforeB = await tenantB.repositories.tenantSubscriptions.getByTenantId("tenant-plan-iso-b");

  // Llamada directa (sin UI) con la sesión/permisos de Tenant A, apuntando a SU PROPIO tenantId.
  await new ChangeTenantPlanService(tenantA.repositories).execute(
    "tenant-plan-iso-a",
    targetPlanId,
    READ_AND_MANAGE,
    tenantA.userId,
  );

  const afterB = await tenantB.repositories.tenantSubscriptions.getByTenantId("tenant-plan-iso-b");
  assert.deepEqual(afterB, beforeB, "15: la Subscription de Tenant B debe permanecer intacta");
}

async function main() {
  await verifyPermissionGating();
  console.log("1-2. permission gating (read sin manage / ningún permiso): PASS");
  await verifyGuardOrderAndOutcomes();
  console.log("3-6. guard order (plan inexistente/archivado, no-op, suspended no bloquea): PASS");
  await verifySideEffectBoundaries();
  console.log("7-10. side-effect boundaries (Users/Branches/BusinessConfig intactos): PASS");
  await verifyAuditLogging();
  console.log("11. AuditLog con la forma exacta: PASS");
  await verifySameTabEventPropagation();
  console.log("12. tenant-subscription.changed emitido exactamente una vez: PASS");
  await verifyAvailablePlansOnlyActive();
  console.log("13. availablePlans lista solo planes activos: PASS");
  await verifyHistoricalReadPreservation();
  console.log("14. lectura histórica sobrevive la pérdida de la capability: PASS");
  await verifyCrossTenantIsolation();
  console.log("15. Tenant A no afecta la Subscription de Tenant B: PASS");
  console.log("\nverify-tenant-plan-selection: ALL PASS");
}

void main();
