/**
 * Harness de regresión para el onboarding técnico de un nuevo Tenant SaaS
 * (feature/tenant-onboarding).
 *
 * Uso (desde la raíz del proyecto):
 *   npx tsx scripts/verify-tenant-onboarding.ts
 *
 * Cubre las 26 verificaciones de la auditoría (§23) más un bonus de
 * "admin self-sufficiency" (§21): alta atómica de Tenant + Branch inicial +
 * Role admin + User admin + AuthAccount + TenantSubscription + config
 * mínima, login end-to-end del nuevo admin, aislamiento cruzado (incluido
 * contra tenant-demo), duplicados denegados, y una prueba REAL de rollback
 * (test double que fuerza un fallo a mitad de la transacción -- nunca un
 * `if` productivo).
 */
import assert from "node:assert/strict";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { permissionsConfig } from "@/config/permissions";
import type { AuthAccount } from "@/core/entities";
import { AccountStatus, PlanCode, PlanStatus, RoleStatus, TenantStatus, UserStatus, UserType } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockAuditLogRepository,
  MockAuthRepository,
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockCustomerRepository,
  MockPlanRepository,
  MockRoleRepository,
  MockTenantOnboardingRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import { CreateEmployeeService } from "@/modules/administration/application/services/CreateEmployeeService";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import { TenantOnboardingService } from "@/modules/administration/application/services/TenantOnboardingService";
import type { TenantOnboardingInputDto } from "@/modules/administration/application/dto/TenantOnboardingDto";

const NOW = "2026-09-15T12:00:00.000Z";
const ACTIVE_PLAN_ID = "plan-onboarding-active";
const ARCHIVED_PLAN_ID = "plan-onboarding-archived";
const CANONICAL_INCIDENT_TYPES = [
  ["DAMAGED", "Producto dañado"],
  ["MISSING", "Producto faltante"],
  ["UNSOLICITED", "Producto no solicitado"],
  ["OTHER", "Otros"],
] as const;

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

/**
 * Test double explícitamente pedido por la auditoría (§24) para provocar un fallo REAL a mitad
 * de la transacción de onboarding, sin agregar ningún `if (input.failStep)` a
 * `MockTenantOnboardingRepository` (código productivo). `onboard()` está partido en pasos
 * `protected` precisamente para que esto sea posible: sobreescribir UN paso intermedio (después
 * de Tenant/Branch/Role/User, antes de config/Subscription) prueba que TODO lo anterior también
 * se descarta -- no solo lo que viene después del paso que falla.
 */
class FailingTenantOnboardingRepository extends MockTenantOnboardingRepository {
  protected override pushAuthAccount(): AuthAccount {
    throw new Error("Simulated failure for atomicity test (forced rollback)");
  }
}

function createHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const sessionStorage = new MemoryStorageAdapter();

  // Plan fixture PROPIO (nunca depender de los IDs del seed real plan-basic/plan-enterprise) --
  // uno activo y uno archivado, para poder probar la validación de plan sin tocar el catálogo
  // demo.
  store.mutate((db) => {
    db.planDefinitions.push(
      {
        id: ACTIVE_PLAN_ID,
        code: PlanCode.basic,
        name: "Plan onboarding activo (fixture)",
        status: PlanStatus.active,
        capabilities: [],
        limits: {},
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: ARCHIVED_PLAN_ID,
        code: PlanCode.enterprise,
        name: "Plan onboarding archivado (fixture)",
        status: PlanStatus.archived,
        capabilities: [],
        limits: {},
        createdAt: NOW,
        updatedAt: NOW,
      },
    );
  });

  const repositories = {
    tenants: new MockTenantRepository(store, eventBus),
    tenantOnboarding: new MockTenantOnboardingRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    auth: new MockAuthRepository(store, eventBus, sessionStorage),
    users: new MockUserRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    branches: new MockBranchRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    auditLogs: new MockAuditLogRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return { store, eventBus, sessionStorage, repositories };
}

function buildOnboardingInput(
  overrides: Partial<TenantOnboardingInputDto> = {},
): TenantOnboardingInputDto {
  const suffix = Math.random().toString(36).slice(2, 9);
  return {
    tenantName: `Tenant Onboarding ${suffix}`,
    tenantSlug: `tenant-onboarding-${suffix}`,
    adminName: "Admin Onboarding",
    adminEmail: `admin-onboarding-${suffix}@example.test`,
    adminPasswordMock: "OnboardingPass1!",
    planId: ACTIVE_PLAN_ID,
    ...overrides,
  };
}

async function verifyIncidentTypeDefaultsAndNormalization() {
  const harness = createHarness();
  const resultA = await new TenantOnboardingService(harness.repositories).execute(
    buildOnboardingInput(),
  );
  const resultB = await new TenantOnboardingService(harness.repositories).execute(
    buildOnboardingInput(),
  );
  const onboardingSnapshot = harness.store.getSnapshot();
  for (const tenantId of [resultA.tenantId, resultB.tenantId]) {
    const defaults = onboardingSnapshot.incidentTypes.filter((item) => item.tenantId === tenantId);
    assert.deepEqual(
      defaults.map(({ code, name }) => [code, name]).sort(),
      [...CANONICAL_INCIDENT_TYPES].sort(),
      "cada Tenant nuevo debe recibir exactamente los cuatro tipos de incidencia canónicos",
    );
    assert.ok(defaults.every((item) => item.tenantId === tenantId && item.active));
  }
  assert.equal(
    onboardingSnapshot.incidentTypes.some(
      (item) => item.tenantId === resultA.tenantId &&
        onboardingSnapshot.incidentTypes.some(
          (other) => other.tenantId === resultB.tenantId && other.id === item.id,
        ),
    ),
    false,
    "los tipos de incidencia deben estar aislados por Tenant",
  );

  const storage = new MemoryStorageAdapter();
  const seededStore = new MockDatabaseStore(storage);
  const storageKey = [...storage.values.keys()][0];
  assert.ok(storageKey, "el store debe persistir su snapshot bajo una clave estable");
  const seededSnapshot = seededStore.getSnapshot();
  assert.deepEqual(
    seededSnapshot.incidentTypes
      .filter((item) => item.tenantId === "tenant-demo")
      .map(({ code, name }) => [code, name])
      .sort(),
    [...CANONICAL_INCIDENT_TYPES].sort(),
    "el seed demo debe contener los cuatro tipos canónicos",
  );

  seededSnapshot.incidentTypes = [
    {
      id: "legacy-damaged",
      tenantId: "tenant-demo",
      code: "DAMAGED",
      name: "Daño legado personalizado",
      active: false,
    },
    {
      id: "legacy-custom",
      tenantId: "tenant-demo",
      code: "CUSTOM_REVIEW",
      name: "Revisión especial",
      active: true,
    },
  ];
  const customerSelfServicePermissions = permissionsConfig
    .filter((permission) => permission.module === "customer" || permission.module === "storefront")
    .map((permission) => permission.key);
  const legacyAdmin = seededSnapshot.roles.find((role) => role.id === "role-admin");
  assert.ok(legacyAdmin, "el admin de sistema del seed debe existir");
  legacyAdmin.permissions = [...legacyAdmin.permissions, ...customerSelfServicePermissions];
  seededSnapshot.roles.push({
    id: "custom-administrator-with-customer-permissions",
    tenantId: "tenant-demo",
    name: "Administrador",
    isSystem: false,
    permissions: [...customerSelfServicePermissions],
    branchScope: "assigned",
    status: RoleStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  });
  storage.set(storageKey, seededSnapshot);

  const normalizedOnce = new MockDatabaseStore(storage).getSnapshot();
  const demoTypes = normalizedOnce.incidentTypes.filter((item) => item.tenantId === "tenant-demo");
  assert.deepEqual(
    demoTypes.filter((item) => CANONICAL_INCIDENT_TYPES.some(([code]) => code === item.code))
      .map((item) => item.code)
      .sort(),
    CANONICAL_INCIDENT_TYPES.map(([code]) => code).sort(),
    "un estado parcial debe completarse sin duplicar DAMAGED",
  );
  assert.equal(demoTypes.filter((item) => item.code === "DAMAGED").length, 1);
  assert.deepEqual(
    demoTypes.find((item) => item.code === "DAMAGED"),
    seededSnapshot.incidentTypes[0],
    "un código existente debe conservar id, nombre y estado aunque haya sido renombrado",
  );
  assert.deepEqual(
    demoTypes.find((item) => item.code === "CUSTOM_REVIEW"),
    seededSnapshot.incidentTypes[1],
    "la normalización debe preservar tipos personalizados",
  );
  const normalizedAdmin = normalizedOnce.roles.find((role) => role.id === "role-admin");
  assert.ok(normalizedAdmin, "el Administrador de sistema debe conservarse");
  assert.equal(
    customerSelfServicePermissions.some((permission) => normalizedAdmin.permissions.includes(permission)),
    false,
    "la normalización debe retirar autoservicio Customer/Storefront del Administrador de sistema",
  );
  const customAdministrator = normalizedOnce.roles.find(
    (role) => role.id === "custom-administrator-with-customer-permissions",
  );
  assert.ok(customAdministrator, "el rol personalizado debe conservarse");
  assert.deepEqual(
    customAdministrator.permissions,
    customerSelfServicePermissions,
    "la normalización no debe alterar roles personalizados",
  );

  const normalizedTwice = new MockDatabaseStore(storage).getSnapshot();
  assert.deepEqual(
    normalizedTwice.incidentTypes,
    normalizedOnce.incidentTypes,
    "normalizar dos veces debe ser idempotente",
  );
}

// 1-17: onboarding exitoso + login end-to-end + resolución de sesión/rol/branch al Tenant nuevo.
async function verifySuccessfulOnboardingAndLogin() {
  const harness = createHarness();
  const input = buildOnboardingInput();
  const result = await new TenantOnboardingService(harness.repositories).execute(input);

  // 1. successful onboarding
  assert.ok(result.tenantId, "1: el onboarding exitoso debe devolver un tenantId");

  // 2. Tenant created (+ defaults de moneda/timezone aplicados al omitirse en el input)
  const tenant = await harness.repositories.tenants.getById(result.tenantId);
  assert.ok(tenant, "2: el Tenant debe existir");
  assert.equal(tenant?.slug, input.tenantSlug);
  assert.equal(tenant?.status, TenantStatus.active);
  assert.equal(tenant?.defaultCurrency, "GTQ", "2: default de moneda aplicado (no vino en el input)");
  assert.equal(tenant?.timezone, "America/Guatemala", "2: default de timezone aplicado");

  // 3. unique Tenant ID -- nunca hardcoded/tenant-demo, y distinto entre dos altas
  assert.notEqual(tenant?.id, "tenant-demo", "3: el id no debe ser tenant-demo");
  assert.ok(tenant!.id.startsWith("tenant-"), "3: el id debe usar el prefijo canónico");
  const secondResult = await new TenantOnboardingService(harness.repositories).execute(
    buildOnboardingInput(),
  );
  assert.notEqual(result.tenantId, secondResult.tenantId, "3: dos altas generan IDs de Tenant distintos");

  // 4-5. admin Role tenant-owned + catálogo canónico de permisos
  const role = await harness.repositories.roles.getByIdScoped(result.tenantId, result.roleId);
  assert.ok(role, "4: el Role admin debe existir y pertenecer al Tenant nuevo");
  assert.equal(role?.tenantId, result.tenantId);
  assert.equal(role?.isSystem, true, "4: el Role admin es un rol de plataforma (isSystem)");
  const employeePermissions = permissionsConfig
    .filter((permission) => permission.module !== "customer" && permission.module !== "storefront")
    .map((permission) => permission.key);
  const customerSelfServicePermissions = permissionsConfig
    .filter((permission) => permission.module === "customer" || permission.module === "storefront")
    .map((permission) => permission.key);
  assert.deepEqual(
    [...(role?.permissions ?? [])].sort(),
    [...employeePermissions].sort(),
    "5: el Role admin debe tener exactamente los permisos canónicos de empleado",
  );
  assert.equal(
    customerSelfServicePermissions.some((permission) => role?.permissions.includes(permission)),
    false,
    "5: el Role admin no debe recibir permisos de Customer/Storefront",
  );
  const customerRole = (await harness.repositories.roles.listByTenant(result.tenantId)).find(
    (candidate) => candidate.isSystem && candidate.name === "Cliente",
  );
  assert.ok(customerRole, "5: el Role Cliente canónico debe existir");
  assert.deepEqual(
    [...(customerRole?.permissions ?? [])].sort(),
    [...customerSelfServicePermissions].sort(),
    "5: el Role Cliente conserva los permisos de autoservicio",
  );

  // 6. initial Branch created
  const branch = await harness.repositories.branches.getByIdScoped(result.tenantId, result.branchId);
  assert.ok(branch, "6: la Branch inicial debe existir y pertenecer al Tenant nuevo");
  assert.equal(branch?.name, "Matriz");

  // 7-9. User created, roleId/branchId/allowedBranchIds correctos
  const user = await harness.repositories.users.getByIdScoped(result.tenantId, result.userId);
  assert.ok(user, "7: el User admin debe existir");
  assert.equal(user?.type, UserType.employee);
  assert.equal(user?.status, UserStatus.active);
  assert.equal(user?.roleId, result.roleId);
  assert.equal(user?.branchId, result.branchId, "8: branchId debe apuntar a la Branch inicial");
  assert.deepEqual(
    user?.allowedBranchIds,
    [result.branchId],
    "9: allowedBranchIds debe ser EXACTAMENTE [branchId]",
  );

  // 10. AuthAccount created
  const snapshotAfterOnboarding = harness.store.getSnapshot();
  const authAccount = snapshotAfterOnboarding.authAccounts.find(
    (item) => item.id === result.authAccountId,
  );
  assert.ok(authAccount, "10: el AuthAccount debe existir");
  assert.equal(authAccount?.userId, result.userId);
  assert.equal(authAccount?.status, AccountStatus.active, "10: la cuenta debe quedar inmediatamente usable");

  // 11-12. Subscription created + planId correcto
  const subscription = await harness.repositories.tenantSubscriptions.getByTenantId(result.tenantId);
  assert.ok(subscription, "11: la Subscription debe existir");
  assert.equal(subscription?.id, result.subscriptionId);
  assert.equal(subscription?.planId, input.planId, "12: planId debe ser el plan solicitado");
  assert.deepEqual(subscription?.addonCodes, [], "12: el tenant nuevo inicia sin addons");

  // 13. config defaults created
  const capabilities = await harness.repositories.businessConfig.getCapabilities(result.tenantId);
  assert.ok(capabilities, "13: BusinessCapabilitiesConfig debe existir");
  assert.equal(capabilities?.supportsLots, true, "13: lots debe iniciar habilitado");
  assert.equal(capabilities?.supportsExpiration, true, "13: expiration debe iniciar habilitado");
  assert.equal(capabilities?.supportsSerials, true, "13: serials debe iniciar habilitado");
  const ecommerceConfig = await harness.repositories.businessConfig.getEcommerceConfig(result.tenantId);
  assert.ok(ecommerceConfig, "13: EcommerceConfig debe existir");
  assert.equal(ecommerceConfig?.enabled, false, "13: EcommerceConfig.enabled debe ser false por default");

  // 14. login successful -- flujo REAL de auth.login(), no un backdoor de sesión
  const loginResult = await harness.repositories.auth.login({
    email: input.adminEmail,
    passwordMock: input.adminPasswordMock,
    expectedUserType: UserType.employee,
  });
  assert.equal(loginResult.status, "authenticated", "14: el login del nuevo admin debe ser exitoso");

  // 15-17. sesión/rol/sucursal resuelven al Tenant nuevo, nunca a tenant-demo
  const snapshot = await resolveCurrentSessionSnapshot(harness.repositories);
  assert.equal(snapshot.user?.id, result.userId);
  assert.equal(snapshot.user?.tenantId, result.tenantId, "15: la sesión debe resolver al Tenant nuevo");
  assert.notEqual(snapshot.user?.tenantId, "tenant-demo", "15: la sesión nunca debe caer a tenant-demo");
  assert.equal(snapshot.role?.id, result.roleId);
  assert.equal(snapshot.role?.tenantId, result.tenantId, "16: el Role resuelto debe pertenecer al Tenant nuevo");
  const branchAfterLogin = await harness.repositories.branches.getByIdScoped(
    result.tenantId,
    snapshot.user?.branchId ?? "",
  );
  assert.ok(branchAfterLogin, "17: la sucursal del admin debe resolver dentro del Tenant nuevo");
  assert.equal(branchAfterLogin?.id, result.branchId);
}

// 18-22: aislamiento cruzado entre Tenants nuevos, contra tenant-demo, y ausencia de datos demo.
async function verifyTenantIsolationAndNoDemoData() {
  const harness = createHarness();
  const resultA = await new TenantOnboardingService(harness.repositories).execute(
    buildOnboardingInput(),
  );
  const resultB = await new TenantOnboardingService(harness.repositories).execute(
    buildOnboardingInput(),
  );

  // 18. Tenant A no accede a recursos de Tenant B
  assert.equal(
    await harness.repositories.users.getByIdScoped(resultA.tenantId, resultB.userId),
    null,
    "18: Tenant A no debe poder leer el User de Tenant B",
  );
  assert.equal(
    await harness.repositories.roles.getByIdScoped(resultA.tenantId, resultB.roleId),
    null,
    "18: Tenant A no debe poder leer el Role de Tenant B",
  );
  assert.equal(
    await harness.repositories.branches.getByIdScoped(resultA.tenantId, resultB.branchId),
    null,
    "18: Tenant A no debe poder leer la Branch de Tenant B",
  );
  const subscriptionA = await harness.repositories.tenantSubscriptions.getByTenantId(resultA.tenantId);
  assert.notEqual(
    subscriptionA?.id,
    resultB.subscriptionId,
    "18: la Subscription de Tenant A no debe ser la de Tenant B",
  );

  // 19. Tenant B no accede a recursos de Tenant A (simétrico)
  assert.equal(
    await harness.repositories.users.getByIdScoped(resultB.tenantId, resultA.userId),
    null,
    "19: Tenant B no debe poder leer el User de Tenant A",
  );
  assert.equal(
    await harness.repositories.roles.getByIdScoped(resultB.tenantId, resultA.roleId),
    null,
    "19: Tenant B no debe poder leer el Role de Tenant A",
  );
  assert.equal(
    await harness.repositories.branches.getByIdScoped(resultB.tenantId, resultA.branchId),
    null,
    "19: Tenant B no debe poder leer la Branch de Tenant A",
  );

  // 20. el Tenant nuevo no accede a recursos de tenant-demo
  assert.equal(
    await harness.repositories.branches.getByIdScoped(resultA.tenantId, "branch-centro"),
    null,
    "20: el Tenant nuevo no debe poder leer una Branch de tenant-demo",
  );
  assert.equal(
    await harness.repositories.roles.getByIdScoped(resultA.tenantId, "role-admin"),
    null,
    "20: el Tenant nuevo no debe poder leer el Role admin de tenant-demo",
  );

  // 21. tenant-demo no accede a recursos del Tenant nuevo
  assert.equal(
    await harness.repositories.branches.getByIdScoped("tenant-demo", resultA.branchId),
    null,
    "21: tenant-demo no debe poder leer la Branch del Tenant nuevo",
  );
  assert.equal(
    await harness.repositories.roles.getByIdScoped("tenant-demo", resultA.roleId),
    null,
    "21: tenant-demo no debe poder leer el Role del Tenant nuevo",
  );

  // 22. sin datos operacionales de demo copiados (Tenant nace limpio salvo defaults técnicos)
  const snapshot = harness.store.getSnapshot();
  for (const tenantId of [resultA.tenantId, resultB.tenantId]) {
    assert.equal(
      snapshot.products.filter((item) => item.tenantId === tenantId).length,
      0,
      "22: products debe estar vacío para el Tenant nuevo",
    );
    assert.equal(
      snapshot.categories.filter((item) => item.tenantId === tenantId).length,
      0,
      "22: categories debe estar vacío",
    );
    assert.equal(
      snapshot.units.filter((item) => item.tenantId === tenantId).length,
      0,
      "22: units debe estar vacío",
    );
    assert.equal(
      snapshot.inventoryBalances.filter((item) => item.tenantId === tenantId).length,
      0,
      "22: inventoryBalances debe estar vacío",
    );
    assert.equal(
      snapshot.purchaseOrders.filter((item) => item.tenantId === tenantId).length,
      0,
      "22: purchaseOrders debe estar vacío",
    );
    assert.equal(
      snapshot.receipts.filter((item) => item.tenantId === tenantId).length,
      0,
      "22: receipts debe estar vacío",
    );
    assert.equal(
      snapshot.sales.filter((item) => item.tenantId === tenantId).length,
      0,
      "22: sales debe estar vacío",
    );
    assert.equal(
      snapshot.customers.filter((item) => item.tenantId === tenantId).length,
      0,
      "22: customers debe estar vacío",
    );
  }
}

// 23-24: idempotencia -- slug/email duplicados se rechazan y no dejan Tenant/User a medias.
async function verifyDuplicateSlugAndEmailDenied() {
  const harness = createHarness();
  const input = buildOnboardingInput();
  await new TenantOnboardingService(harness.repositories).execute(input);

  // 23. duplicate tenantSlug denied
  await assert.rejects(
    new TenantOnboardingService(harness.repositories).execute(
      buildOnboardingInput({ tenantSlug: input.tenantSlug }),
    ),
    AdministrationServiceError,
    "23: un segundo onboarding con el mismo slug debe ser rechazado",
  );
  const tenantsWithSlug = (await harness.repositories.tenants.getAll()).filter(
    (tenant) => tenant.slug === input.tenantSlug,
  );
  assert.equal(tenantsWithSlug.length, 1, "23: no debe haberse creado un Tenant duplicado");

  // 24. duplicate admin identity (email) denied
  await assert.rejects(
    new TenantOnboardingService(harness.repositories).execute(
      buildOnboardingInput({ adminEmail: input.adminEmail }),
    ),
    AdministrationServiceError,
    "24: un segundo onboarding con el mismo correo de admin debe ser rechazado",
  );
  const usersWithEmail = (await harness.repositories.users.getAll()).filter(
    (user) => user.email.toLowerCase() === input.adminEmail.toLowerCase(),
  );
  assert.equal(usersWithEmail.length, 1, "24: no debe haberse creado un User duplicado para ese correo");
}

// 25-26: rollback real ante un fallo forzado a mitad de la transacción, y reintento seguro.
async function verifyForcedRollbackAndSafeRetry() {
  const harness = createHarness();
  const input = buildOnboardingInput();
  const before = harness.store.getSnapshot();

  const failingRepositories: RepositoryRegistry = {
    ...harness.repositories,
    tenantOnboarding: new FailingTenantOnboardingRepository(harness.store, harness.eventBus),
  };

  // 25. forced failure midway => complete rollback
  await assert.rejects(
    new TenantOnboardingService(failingRepositories).execute(input),
    /Simulated failure for atomicity test/,
    "25: el fallo forzado debe propagarse y NO completar el onboarding",
  );

  const afterFailure = harness.store.getSnapshot();
  assert.equal(afterFailure.tenants.length, before.tenants.length, "25: ningún Tenant debe quedar persistido");
  assert.equal(afterFailure.branches.length, before.branches.length, "25: ninguna Branch debe quedar persistida");
  assert.equal(afterFailure.roles.length, before.roles.length, "25: ningún Role debe quedar persistido");
  assert.equal(afterFailure.users.length, before.users.length, "25: ningún User debe quedar persistido");
  assert.equal(
    afterFailure.authAccounts.length,
    before.authAccounts.length,
    "25: ningún AuthAccount debe quedar persistido",
  );
  assert.equal(
    afterFailure.tenantSubscriptions.length,
    before.tenantSubscriptions.length,
    "25: ninguna Subscription debe quedar persistida",
  );
  assert.equal(
    afterFailure.businessCapabilities.length,
    before.businessCapabilities.length,
    "25: ninguna BusinessCapabilitiesConfig debe quedar persistida",
  );
  assert.equal(
    afterFailure.ecommerceConfigs.length,
    before.ecommerceConfigs.length,
    "25: ningún EcommerceConfig debe quedar persistido",
  );
  assert.equal(
    afterFailure.incidentTypes.length,
    before.incidentTypes.length,
    "25: ningún IncidentType debe quedar persistido",
  );
  assert.equal(
    await harness.repositories.tenants.getBySlug(input.tenantSlug),
    null,
    "25: el slug debe quedar disponible -- ningún Tenant a medio crear",
  );

  // 26. retry after failed transaction behaves safely
  const retryResult = await new TenantOnboardingService(harness.repositories).execute(input);
  assert.ok(retryResult.tenantId, "26: reintentar con el MISMO input tras el fallo debe completar exitosamente");
  const tenantsWithSlugAfterRetry = (await harness.repositories.tenants.getAll()).filter(
    (tenant) => tenant.slug === input.tenantSlug,
  );
  assert.equal(
    tenantsWithSlugAfterRetry.length,
    1,
    "26: debe existir EXACTAMENTE un Tenant con ese slug tras el reintento (no dos)",
  );
}

// Plan inexistente/no activo denegados (validación previa a la transacción atómica).
async function verifyPlanValidation() {
  const harness = createHarness();
  const tenantsBefore = (await harness.repositories.tenants.getAll()).length;

  await assert.rejects(
    new TenantOnboardingService(harness.repositories).execute(
      buildOnboardingInput({ planId: "plan-does-not-exist" }),
    ),
    AdministrationServiceError,
    "un planId inexistente debe ser rechazado",
  );

  await assert.rejects(
    new TenantOnboardingService(harness.repositories).execute(
      buildOnboardingInput({ planId: ARCHIVED_PLAN_ID }),
    ),
    AdministrationServiceError,
    "un plan archivado (no activo) debe ser rechazado",
  );

  assert.equal(
    (await harness.repositories.tenants.getAll()).length,
    tenantsBefore,
    "ningún Tenant nuevo debe crearse cuando el plan es inválido",
  );
}

// §21 bonus: admin self-sufficiency -- el admin nuevo tiene sesión/rol/permisos/branch access
// suficientes para usar Administration (crear un segundo User del mismo tenant vía el servicio
// EXISTENTE, sin necesitar bootstrapEmployeeAccount otra vez).
async function verifyAdminSelfSufficiency() {
  const harness = createHarness();
  const result = await new TenantOnboardingService(harness.repositories).execute(
    buildOnboardingInput(),
  );

  const canonicalPermissions = permissionsConfig.map((permission) => permission.key);
  const created = await new CreateEmployeeService(harness.repositories).execute(
    result.tenantId,
    {
      name: "Segundo Empleado",
      email: `second-employee-${Math.random().toString(36).slice(2, 9)}@example.test`,
      phone: undefined,
      employeeCode: `SEC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      roleId: result.roleId,
      allowedBranchIds: [result.branchId],
      status: UserStatus.active,
    },
    canonicalPermissions,
    result.userId,
  );
  const secondEmployee = await harness.repositories.users.getByIdScoped(
    result.tenantId,
    created.employee.id,
  );
  assert.ok(
    secondEmployee,
    "21: el admin nuevo debe poder crear un segundo User de su propio tenant vía Administration",
  );
  assert.equal(typeof created.invitationToken, "string", "21: el alta reutiliza el flujo real de invitación");
}

async function main() {
  await verifyIncidentTypeDefaultsAndNormalization();
  console.log("incident types canónicos, aislamiento y normalización idempotente: PASS");
  await verifySuccessfulOnboardingAndLogin();
  console.log("1-17. onboarding exitoso, defaults, permisos canónicos, y login end-to-end: PASS");
  await verifyTenantIsolationAndNoDemoData();
  console.log("18-22. aislamiento cruzado (incluido tenant-demo) y sin datos operacionales demo: PASS");
  await verifyDuplicateSlugAndEmailDenied();
  console.log("23-24. slug/email duplicados denegados, sin Tenant/User a medias: PASS");
  await verifyForcedRollbackAndSafeRetry();
  console.log("25-26. rollback real ante fallo forzado + reintento seguro: PASS");
  await verifyPlanValidation();
  console.log("plan inexistente/archivado denegado: PASS");
  await verifyAdminSelfSufficiency();
  console.log("21 (bonus). admin self-sufficiency -- Administration usable tras el onboarding: PASS");
}

void main();
