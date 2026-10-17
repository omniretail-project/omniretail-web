import assert from "node:assert/strict";
import {
  BranchStatus,
  BranchType,
  BusinessPreset,
  PlanCode,
  PlanStatus,
  SaasCapabilityKey,
  SaasLimitKey,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockPlanRepository,
  MockTenantSubscriptionRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import { GetTenantUsageService } from "@/modules/administration/application/services/GetTenantUsageService";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import { PLANS_READ_PERMISSION } from "@/modules/administration/permissions";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { SaasEntitlementError } from "@/shared/application/services/entitlementGuards";

const NOW = "2026-09-15T12:00:00.000Z";
const TENANT_DEMO = "tenant-demo";
const TENANT_B = "tenant-saas-b";
const TENANT_NO_SUB = "tenant-saas-no-subscription";

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
 * `plan-test-limited` NUNCA reusa plan-basic/plan-enterprise del seed real -- así test 3/4
 * prueban que el resolver devuelve las capabilities/limits del plan REALMENTE vinculado por la
 * Subscription, no "cualquier plan" ni el primero de la lista. `code` reusa PlanCode.basic
 * porque el enum canónico solo tiene basic/enterprise (§12 del ticket: no se inventa un tercer
 * código); lo que identifica el plan en el test es `id`, vía `subscription.planId`.
 */
function createSaasHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    db.tenants.push(
      {
        id: TENANT_B,
        name: "SaaS Foundation Test Tenant B",
        slug: "saas-foundation-b",
        status: TenantStatus.active,
        defaultCurrency: "GTQ",
        timezone: "America/Guatemala",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: TENANT_NO_SUB,
        name: "SaaS Foundation Test Tenant No Sub",
        slug: "saas-foundation-no-sub",
        status: TenantStatus.active,
        defaultCurrency: "GTQ",
        timezone: "America/Guatemala",
        createdAt: NOW,
        updatedAt: NOW,
      },
    );

    db.planDefinitions.push({
      id: "plan-test-limited",
      code: PlanCode.basic,
      name: "Limited (test fixture)",
      status: PlanStatus.active,
      capabilities: [SaasCapabilityKey.inventory, SaasCapabilityKey.pos],
      limits: { [SaasLimitKey.maxEmployees]: 5, [SaasLimitKey.maxBranches]: 2 },
      createdAt: NOW,
      updatedAt: NOW,
    });

    db.tenantSubscriptions.push({
      id: "tenant-subscription-b",
      tenantId: TENANT_B,
      planId: "plan-test-limited",
      status: TenantSubscriptionStatus.active,
      startedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // Usage fixtures para TENANT_B: 2 employees cuentan (active + inactive), 1 NO cuenta
    // (archived); 1 customer nunca cuenta aunque esté active. Mismo criterio para branches: 2
    // cuentan (active + inactive), 1 NO cuenta (archived).
    db.users.push(
      {
        id: "user-saas-b-employee-active",
        tenantId: TENANT_B,
        name: "Employee Active",
        email: "employee-active@saas-b.test",
        type: UserType.employee,
        status: UserStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "user-saas-b-employee-inactive",
        tenantId: TENANT_B,
        name: "Employee Inactive",
        email: "employee-inactive@saas-b.test",
        type: UserType.employee,
        status: UserStatus.inactive,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "user-saas-b-employee-archived",
        tenantId: TENANT_B,
        name: "Employee Archived",
        email: "employee-archived@saas-b.test",
        type: UserType.employee,
        status: UserStatus.archived,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "user-saas-b-customer-active",
        tenantId: TENANT_B,
        name: "Customer Active",
        email: "customer-active@saas-b.test",
        type: UserType.customer,
        status: UserStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
    );
    db.branches.push(
      {
        id: "branch-saas-b-active",
        tenantId: TENANT_B,
        code: "SAASB-ACT",
        name: "Sucursal activa",
        type: BranchType.store,
        status: BranchStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "branch-saas-b-inactive",
        tenantId: TENANT_B,
        code: "SAASB-INA",
        name: "Sucursal inactiva",
        type: BranchType.store,
        status: BranchStatus.inactive,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "branch-saas-b-archived",
        tenantId: TENANT_B,
        code: "SAASB-ARC",
        name: "Sucursal archivada",
        type: BranchType.store,
        status: BranchStatus.archived,
        createdAt: NOW,
        updatedAt: NOW,
      },
    );

    // BusinessCapabilitiesConfig/EcommerceConfig "permisivos" para TENANT_B a propósito (§9 del
    // test) -- el plan vinculado (plan-test-limited) NO incluye ecommerce ni kits. Probar que el
    // resolver ignora esto es exactamente el punto: BusinessCapabilitiesConfig/EcommerceConfig
    // NUNCA sustituyen el entitlement.
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
      supportsKits: true,
      supportsServices: false,
      defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
    });
    db.ecommerceConfigs.push({
      tenantId: TENANT_B,
      enabled: true,
      storeName: "SaaS B Store",
      requireAccountForCheckout: false,
      guestTrackingEnabled: false,
      allowedDeliveryMethods: [],
      allowedPaymentMethods: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  const repositories = {
    plans: new MockPlanRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
    branches: new MockBranchRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return { repositories, store };
}

async function verifyPlanCatalog() {
  const { repositories } = createSaasHarness();

  // 1. Basic es la oferta activa; Enterprise se conserva archivado para migración legacy.
  const basic = await repositories.plans.getByCode(PlanCode.basic);
  const enterprise = await repositories.plans.getByCode(PlanCode.enterprise);
  assert.ok(basic, "1: plan-basic debe existir en el catálogo");
  assert.ok(enterprise, "1: plan-enterprise debe existir en el catálogo");
  assert.equal(basic?.status, PlanStatus.active);
  assert.equal(enterprise?.status, PlanStatus.archived);
  assert.ok(
    enterprise?.capabilities.includes(SaasCapabilityKey.ecommerce),
    "1: enterprise incluye ecommerce",
  );
  assert.ok(
    !basic?.capabilities.includes(SaasCapabilityKey.ecommerce),
    "1: basic NO incluye ecommerce",
  );

  const activePlans = await repositories.plans.listActive();
  assert.ok(activePlans.some((plan) => plan.id === basic?.id));
  assert.ok(!activePlans.some((plan) => plan.id === enterprise?.id));
}

async function verifyDemoSubscription() {
  const { repositories } = createSaasHarness();

  // 2. Tenant demo tiene Subscription válida.
  const subscription = await repositories.tenantSubscriptions.getByTenantId(TENANT_DEMO);
  assert.ok(subscription, "2: tenant-demo debe tener una TenantSubscription");
  assert.equal(subscription?.tenantId, TENANT_DEMO);
  assert.equal(subscription?.status, TenantSubscriptionStatus.active);

  const entitlements = await new ResolveTenantEntitlementsService(repositories).execute(
    TENANT_DEMO,
  );
  assert.equal(entitlements.planCode, PlanCode.basic, "2: demo queda en Basic con complementos");
  assert.equal(entitlements.subscriptionStatus, TenantSubscriptionStatus.active);
}

async function verifyResolverCapabilitiesAndLimits() {
  const { repositories } = createSaasHarness();

  // 3. Resolver retorna capabilities del plan correcto (no las del plan de OTRO tenant).
  const demoEntitlements = await new ResolveTenantEntitlementsService(repositories).execute(
    TENANT_DEMO,
  );
  const tenantBEntitlements = await new ResolveTenantEntitlementsService(repositories).execute(
    TENANT_B,
  );
  assert.deepEqual(
    new Set(demoEntitlements.capabilities),
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
    "3: demo tiene las capabilities de Basic y sus dos complementos",
  );
  assert.deepEqual(
    new Set(tenantBEntitlements.capabilities),
    new Set([SaasCapabilityKey.inventory, SaasCapabilityKey.pos]),
    "3: tenant B (plan-test-limited) tiene solo inventory/pos, no las de demo",
  );

  // 4. Resolver retorna limits del plan correcto.
  assert.deepEqual(demoEntitlements.limits, {}, "4: demo (Basic) sin límites definidos");
  assert.deepEqual(
    tenantBEntitlements.limits,
    { [SaasLimitKey.maxEmployees]: 5, [SaasLimitKey.maxBranches]: 2 },
    "4: tenant B resuelve los límites de SU plan, no los de demo",
  );
}

async function verifyCrossTenantIsolation() {
  const { repositories } = createSaasHarness();

  // 5. Tenant A no puede obtener Subscription de Tenant B.
  const demoSubscription = await repositories.tenantSubscriptions.getByTenantId(TENANT_DEMO);
  const tenantBSubscription = await repositories.tenantSubscriptions.getByTenantId(TENANT_B);
  assert.notEqual(demoSubscription?.id, tenantBSubscription?.id);
  assert.notEqual(demoSubscription?.planId, tenantBSubscription?.planId);
  assert.equal(demoSubscription?.tenantId, TENANT_DEMO);
  assert.equal(tenantBSubscription?.tenantId, TENANT_B);
}

async function verifyFailClosedWithoutSubscription() {
  const { repositories } = createSaasHarness();

  // 6. Tenant sin Subscription: fail-closed / error esperado -- nunca asume Enterprise.
  await assert.rejects(
    new ResolveTenantEntitlementsService(repositories).execute(TENANT_NO_SUB),
    SaasEntitlementError,
    "6: un tenant sin Subscription debe fallar, no resolver ningún plan por default",
  );
  await assert.rejects(
    new GetTenantSubscriptionDetailsService(repositories).execute(TENANT_NO_SUB, [
      PLANS_READ_PERMISSION,
    ]),
    AdministrationServiceError,
    "6: el read model también falla fail-closed sin Subscription",
  );
}

async function verifyUsageCounting() {
  const { repositories } = createSaasHarness();
  const usage = await new GetTenantUsageService(repositories).execute(TENANT_B);

  // 7. Usage employees solo cuenta Employee tenant-scoped y status != archived.
  assert.equal(
    usage.employees.current,
    2,
    "7: cuenta employee-active + employee-inactive, no el archived ni el customer",
  );
  assert.equal(usage.employees.limit, 5);

  // 8. Usage branches solo cuenta tenant correcto y status != archived.
  assert.equal(
    usage.branches.current,
    2,
    "8: cuenta branch-active + branch-inactive, no la archived",
  );
  assert.equal(usage.branches.limit, 2);
}

async function verifyBusinessConfigNeverSubstitutesEntitlement() {
  const { repositories } = createSaasHarness();
  const entitlements = await new ResolveTenantEntitlementsService(repositories).execute(TENANT_B);

  // 9. BusinessCapabilitiesConfig NO sustituye el entitlement -- supportsKits=true en tenant B
  // no otorga catalog.kits: el plan vinculado no lo incluye.
  const capabilities = await repositories.businessConfig.getCapabilities(TENANT_B);
  assert.equal(capabilities?.supportsKits, true, "fixture: BusinessCapabilitiesConfig permisivo");
  assert.ok(
    !entitlements.capabilities.includes(SaasCapabilityKey.catalogKits),
    "9: supportsKits=true en BusinessCapabilitiesConfig no concede catalog.kits",
  );

  // 10. EcommerceConfig.enabled=true NO concede ecommerce si el entitlement no existe.
  const ecommerceConfig = await repositories.businessConfig.getEcommerceConfig(TENANT_B);
  assert.equal(ecommerceConfig?.enabled, true, "fixture: EcommerceConfig.enabled=true");
  assert.ok(
    !entitlements.capabilities.includes(SaasCapabilityKey.ecommerce),
    "10: EcommerceConfig.enabled=true no concede ecommerce sin el entitlement del plan",
  );

  // Bonus (§8 del ticket): el read model SÍ distingue entitlement de business config para
  // ecommerce -- demo lo tiene incluido Y activado; tenant B no lo tiene incluido en absoluto
  // (operationalStatus solo se calcula cuando included=true).
  const demoDetails = await new GetTenantSubscriptionDetailsService(repositories).execute(
    TENANT_DEMO,
    [PLANS_READ_PERMISSION],
  );
  const demoEcommerce = demoDetails.capabilities.find(
    (item) => item.key === SaasCapabilityKey.ecommerce,
  );
  assert.equal(demoEcommerce?.included, true);
  assert.equal(demoEcommerce?.operationalStatus, "Tienda activada");

  const tenantBDetails = await new GetTenantSubscriptionDetailsService(repositories).execute(
    TENANT_B,
    [PLANS_READ_PERMISSION],
  );
  const tenantBEcommerce = tenantBDetails.capabilities.find(
    (item) => item.key === SaasCapabilityKey.ecommerce,
  );
  assert.equal(tenantBEcommerce?.included, false);
  assert.equal(
    tenantBEcommerce?.operationalStatus,
    undefined,
    "bonus: sin entitlement, no se calcula operationalStatus aunque EcommerceConfig.enabled=true",
  );
}

async function verifyReadModelPermissionGuard() {
  const { repositories } = createSaasHarness();

  await assert.rejects(
    new GetTenantSubscriptionDetailsService(repositories).execute(TENANT_DEMO, []),
    AdministrationServiceError,
    "el read model exige admin.plans.read",
  );
}

async function main() {
  await verifyPlanCatalog();
  console.log("1. plan catalog (basic/enterprise): PASS");
  await verifyDemoSubscription();
  console.log("2. demo tenant subscription: PASS");
  await verifyResolverCapabilitiesAndLimits();
  console.log("3-4. resolver capabilities/limits del plan correcto: PASS");
  await verifyCrossTenantIsolation();
  console.log("5. cross-tenant subscription isolation: PASS");
  await verifyFailClosedWithoutSubscription();
  console.log("6. fail-closed sin subscription: PASS");
  await verifyUsageCounting();
  console.log("7-8. usage employees/branches tenant-scoped y status != archived: PASS");
  await verifyBusinessConfigNeverSubstitutesEntitlement();
  console.log("9-10. BusinessCapabilitiesConfig/EcommerceConfig no sustituyen el entitlement: PASS");
  await verifyReadModelPermissionGuard();
  console.log("read model exige admin.plans.read: PASS");
}

void main();
