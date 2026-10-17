import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import { BranchStatus, BranchType, PlanCode, SaasCapabilityKey, UserStatus } from "@/core/enums";
import { permissionsConfig } from "@/config/permissions";
import { subscriptionTotalQuetzales } from "@/core/subscription/catalog";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { createMockDatabase } from "@/infrastructure/mock/database/createMockDatabase";
import {
  MockAuditLogRepository, MockBranchRepository, MockBusinessConfigRepository,
  MockPlanRepository, MockTenantSubscriptionRepository, MockUserRepository,
  MockRoleRepository, MockTenantRepository, MockSalesRepository,
  MockPurchaseOrderRepository, MockInventoryRepository, MockPaymentRepository,
  MockSupplierRepository, MockProductRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { MOCK_DATABASE_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import { getBillingCycle } from "@/modules/administration/application/services/subscriptionBilling";
import { UpdateTenantSubscriptionService } from "@/modules/administration/application/services/UpdateTenantSubscriptionService";
import { GetReportsService } from "@/modules/administration/application/services/GetReportsService";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { CreateEmployeeService } from "@/modules/administration/application/services/CreateEmployeeService";
import { CreateBranchService } from "@/modules/administration/application/services/CreateBranchService";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { GetEcommerceConfigService } from "@/modules/administration/application/services/GetEcommerceConfigService";
import { SaveEcommerceConfigService } from "@/modules/administration/application/services/SaveEcommerceConfigService";
import { GetPublicStorefrontConfigService } from "@/modules/storefront/application/services/GetPublicStorefrontConfigService";
import { administrationNavigation } from "@/modules/administration/navigation";
import { isNavigationItemEntitled, isNavigationItemPermitted } from "@/shared/navigation/Sidebar";
import { SaasEntitlementError } from "@/shared/application/services/entitlementGuards";

class MemoryStorage extends LocalStorageAdapter {
  readonly values = new Map<string, unknown>();
  override get<T>(key: string): T | null { return (this.values.get(key) as T | undefined) ?? null; }
  override set<T>(key: string, value: T): void { this.values.set(key, structuredClone(value)); }
}

async function main() {
  assert.equal(subscriptionTotalQuetzales([]), 199);
  assert.equal(subscriptionTotalQuetzales(["ecommerce_delivery"]), 328);
  assert.equal(subscriptionTotalQuetzales(["advanced_reports"]), 298);
  assert.equal(subscriptionTotalQuetzales(["ecommerce_delivery", "advanced_reports"]), 427);
  assert.equal(getBillingCycle("2026-01-31T00:00:00.000Z", new Date("2026-02-28T12:00:00.000Z")).nextRenewalAt, "2026-03-31T00:00:00.000Z");
  const freshBasicPlan = createMockDatabase().planDefinitions.find((plan) => plan.code === PlanCode.basic)!;
  assert(freshBasicPlan.capabilities.includes(SaasCapabilityKey.traceabilityLots));
  assert(freshBasicPlan.capabilities.includes(SaasCapabilityKey.traceabilityExpiration));
  assert(freshBasicPlan.capabilities.includes(SaasCapabilityKey.traceabilitySerials));
  assert(!freshBasicPlan.capabilities.includes(SaasCapabilityKey.ecommerce));
  assert(!freshBasicPlan.capabilities.includes(SaasCapabilityKey.advancedReports));

  const storage = new MemoryStorage();
  const legacy = createMockDatabase();
  const legacyBasicPlan = legacy.planDefinitions.find((plan) => plan.code === PlanCode.basic)!;
  legacyBasicPlan.limits = { maxEmployees: 3, maxBranches: 1 };
  legacyBasicPlan.capabilities = [SaasCapabilityKey.inventory, SaasCapabilityKey.inventory];
  legacy.tenantSubscriptions[0].planId = "plan-enterprise";
  legacy.tenantSubscriptions[0].addonCodes = undefined;
  const legacySubscription = structuredClone(legacy.tenantSubscriptions[0]);
  legacy.subscriptionInvoices = [{
    id: "legacy-invoice",
    tenantId: legacySubscription.tenantId,
    cycleStart: "2026-01-01T00:00:00.000Z",
    cycleEnd: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    addonCodes: ["ecommerce_delivery"],
    baseQuetzales: 199,
    addonLines: [{ code: "ecommerce_delivery", name: "E-commerce", amountQuetzales: 129 }],
    totalQuetzales: 328,
    status: "simulated",
  }];
  storage.set(MOCK_DATABASE_STORAGE_KEY, legacy);
  const store = new MockDatabaseStore(storage);
  const migrated = store.getSnapshot();
  assert.equal(migrated.tenantSubscriptions[0].planId, "plan-basic");
  assert.equal(migrated.tenantSubscriptions[0].id, legacySubscription.id);
  assert.equal(migrated.tenantSubscriptions[0].status, legacySubscription.status);
  assert.deepEqual(migrated.tenantSubscriptions[0].addonCodes, ["ecommerce_delivery", "advanced_reports"]);
  assert.deepEqual(createMockDatabase().planDefinitions.find((plan) => plan.code === PlanCode.basic)?.limits, {});
  assert.deepEqual(migrated.planDefinitions.find((plan) => plan.code === PlanCode.basic)?.limits, {});
  assert.deepEqual(migrated.planDefinitions.find((plan) => plan.code === PlanCode.basic)?.capabilities, [
    SaasCapabilityKey.inventory,
    SaasCapabilityKey.traceabilityLots,
    SaasCapabilityKey.traceabilityExpiration,
    SaasCapabilityKey.traceabilitySerials,
  ]);
  assert.deepEqual(migrated.subscriptionInvoices, legacy.subscriptionInvoices);
  store.mutate((db) => {
    db.tenants.push({ ...db.tenants[0], id: "another-tenant", slug: "another-tenant" });
    db.branches.push({ ...db.branches[0], id: "another-branch", tenantId: "another-tenant", code: "OTHER" });
    db.roles.push({ ...db.roles.find((role) => role.id === "role-admin")!, id: "another-role", tenantId: "another-tenant" });
    db.users.push({ ...db.users.find((user) => user.id === "user-admin")!, id: "another-user", tenantId: "another-tenant", roleId: "another-role", email: "other@tenant.demo", branchId: "another-branch", allowedBranchIds: ["another-branch"] });
    db.tenantSubscriptions.push({ ...db.tenantSubscriptions[0], id: "another-subscription", tenantId: "another-tenant", addonCodes: [] });
  });

  const events = new DataEventBus();
  let actorUserId = "user-admin";
  const repositories = {
    plans: new MockPlanRepository(store, events),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, events),
    users: new MockUserRepository(store, events),
    branches: new MockBranchRepository(store, events),
    businessConfig: new MockBusinessConfigRepository(store, events),
    auditLogs: new MockAuditLogRepository(store, events),
    roles: new MockRoleRepository(store, events),
    tenants: new MockTenantRepository(store, events),
    sales: new MockSalesRepository(store, events),
    purchaseOrders: new MockPurchaseOrderRepository(store, events),
    inventory: new MockInventoryRepository(store, events),
    payments: new MockPaymentRepository(store, events),
    suppliers: new MockSupplierRepository(store, events),
    products: new MockProductRepository(store, events),
    auth: {
      getCurrentSessionId: async () => "session-demo",
      getSession: async () => ({ id: "session-demo", userId: actorUserId, expiresAt: "2099-01-01T00:00:00.000Z" }),
      inviteEmployee: async () => ({ invitationToken: "demo-invitation" }),
    },
    orders: { listByBranch: async () => [] },
  } as unknown as RepositoryRegistry;
  const read = new GetTenantSubscriptionDetailsService(repositories);
  const manage = new UpdateTenantSubscriptionService(repositories);
  const permissions = ["admin.plans.read", "admin.plans.manage"];
  const adminPermissions = permissionsConfig.map((permission) => permission.key);
  const ecommerceNav = administrationNavigation[0].children.find((item) => item.id === "administration-ecommerce-config")!;
  const reportsNav = administrationNavigation[0].children.find((item) => item.id === "administration-reports")!;
  const hasCapability = (key: SaasCapabilityKey, capabilities: readonly SaasCapabilityKey[]) => capabilities.includes(key);
  const ecommerceConfig = new GetEcommerceConfigService(repositories);
  const saveEcommerceConfig = new SaveEcommerceConfigService(repositories);
  const initialConfig = await ecommerceConfig.execute();
  const reports = new GetReportsService(repositories);
  const allCapabilities = (await new ResolveTenantEntitlementsService(repositories).execute("tenant-demo")).effectiveCapabilities;
  assert(isNavigationItemPermitted(ecommerceNav, new Set(adminPermissions)) && isNavigationItemEntitled(ecommerceNav, (key) => hasCapability(key, allCapabilities)));
  assert(!isNavigationItemPermitted(ecommerceNav, new Set([])));
  assert(isNavigationItemPermitted(reportsNav, new Set(adminPermissions)) && isNavigationItemEntitled(reportsNav, (key) => hasCapability(key, allCapabilities)));
  assert.equal((await reports.execute()).tenantId, "tenant-demo");
  assert.equal(await reports.authorizeExport(), "tenant-demo");
  const initialRolePermissions = (await repositories.roles.getByIdScoped("tenant-demo", "role-admin"))!.permissions;
  store.mutate((db) => { db.roles.find((role) => role.id === "role-admin")!.permissions = initialRolePermissions.filter((permission) => permission !== "admin.reports.export"); });
  assert.equal((await reports.execute()).tenantId, "tenant-demo");
  await assert.rejects(() => reports.authorizeExport());
  store.mutate((db) => { db.roles.find((role) => role.id === "role-admin")!.permissions = initialRolePermissions; });
  const employeesBefore = (await repositories.users.listByTenant("tenant-demo")).filter((user) => user.type === "employee").length;
  const branchesBefore = (await repositories.branches.listByTenant("tenant-demo")).length;
  assert(employeesBefore >= 3 && branchesBefore >= 1);
  const employeeInput = {
    name: "Empleado sin cupo",
    email: "sin-cupo@ferrepharma.demo",
    employeeCode: "SIN-CUPO",
    roleId: "role-cashier",
    allowedBranchIds: ["branch-centro"],
    status: UserStatus.active,
  };
  const branchInput = {
    code: "SIN-CUPO",
    name: "Sucursal sin cupo",
    type: BranchType.store,
    status: BranchStatus.active,
  };
  await assert.rejects(() => new CreateEmployeeService(repositories).execute("tenant-demo", employeeInput, [], "user-admin"));
  await assert.rejects(() => new CreateEmployeeService(repositories).execute("tenant-demo", { ...employeeInput, email: "invalido" }, adminPermissions, "user-admin"));
  await assert.rejects(() => new CreateBranchService(repositories).execute("tenant-demo", branchInput, [], "user-admin"));
  await new CreateEmployeeService(repositories).execute("tenant-demo", employeeInput, adminPermissions, "user-admin");
  await new CreateBranchService(repositories).execute("tenant-demo", branchInput, adminPermissions, "user-admin");
  assert.equal((await repositories.users.listByTenant("tenant-demo")).filter((user) => user.type === "employee").length, employeesBefore + 1);
  assert.equal((await repositories.branches.listByTenant("tenant-demo")).length, branchesBefore + 1);
  assert.equal((await repositories.users.listByTenant("another-tenant")).length, 1);
  assert.equal((await repositories.branches.listByTenant("another-tenant")).length, 1);
  const before = await read.execute("tenant-demo", permissions);
  assert.equal(before.usage.find((item) => item.key === "maxEmployees")?.limit, null);
  assert.equal(before.usage.find((item) => item.key === "maxBranches")?.limit, null);
  const currentInvoice = before.invoices.find((invoice) => invoice.totalQuetzales === 427);
  assert.equal(currentInvoice?.totalQuetzales, 427);
  assert.equal((await read.execute("tenant-demo", permissions)).invoices.length, 2);
  // Un caller de mutación sin lectura previa conserva el precio del ciclo vigente.
  store.mutate((db) => { db.subscriptionInvoices = []; });
  await manage.execute("tenant-demo", ["ecommerce_delivery"], permissions, "user-admin");
  const after = await read.execute("tenant-demo", permissions);
  assert.deepEqual(after.addonCodes, ["ecommerce_delivery"]);
  assert.equal(after.invoices.length, 1);
  assert.equal(after.invoices[0].totalQuetzales, 427);
  const entitlements = await new ResolveTenantEntitlementsService(repositories).execute("tenant-demo");
  assert(entitlements.effectiveCapabilities.includes(SaasCapabilityKey.delivery));
  assert(!entitlements.effectiveCapabilities.includes(SaasCapabilityKey.advancedReports));
  assert(isNavigationItemEntitled(ecommerceNav, (key) => hasCapability(key, entitlements.effectiveCapabilities)));
  assert(isNavigationItemEntitled(reportsNav, (key) => hasCapability(key, entitlements.effectiveCapabilities)));
  assert.equal((await reports.execute()).tenantId, "tenant-demo");
  await assert.rejects(() => reports.authorizeExport(), (error: unknown) => error instanceof SaasEntitlementError && error.code === "CAPABILITY_REQUIRED");
  const dispatch = new DispatchApplicationService(repositories);
  assert.deepEqual(await dispatch.getPreparedQueue("branch-centro"), []);
  await manage.execute("tenant-demo", ["advanced_reports"], permissions, "user-admin");
  // Dejar de contratar entregas no bloquea una obligación logística ya existente.
  assert.deepEqual(await dispatch.getPreparedQueue("branch-centro"), []);
  const withoutEcommerce = (await new ResolveTenantEntitlementsService(repositories).execute("tenant-demo")).effectiveCapabilities;
  assert(!isNavigationItemEntitled(ecommerceNav, (key) => hasCapability(key, withoutEcommerce)));
  assert(isNavigationItemEntitled(reportsNav, (key) => hasCapability(key, withoutEcommerce)));
  assert.equal((await reports.execute()).tenantId, "tenant-demo");
  assert.equal(await reports.authorizeExport(), "tenant-demo");
  await assert.rejects(() => ecommerceConfig.execute(), (error: unknown) => error instanceof SaasEntitlementError && error.code === "CAPABILITY_REQUIRED");
  await assert.rejects(() => saveEcommerceConfig.execute(initialConfig), (error: unknown) => error instanceof SaasEntitlementError && error.code === "CAPABILITY_REQUIRED");
  assert.deepEqual(await repositories.businessConfig.getEcommerceConfig("tenant-demo"), { ...initialConfig, tenantId: "tenant-demo" });
  await manage.execute("tenant-demo", ["ecommerce_delivery", "advanced_reports"], permissions, "user-admin");
  const reactivated = (await new ResolveTenantEntitlementsService(repositories).execute("tenant-demo")).effectiveCapabilities;
  assert(isNavigationItemEntitled(ecommerceNav, (key) => hasCapability(key, reactivated)));
  assert.deepEqual(await ecommerceConfig.execute(), initialConfig);
  store.mutate((db) => { db.ecommerceConfigs.find((item) => item.tenantId === "tenant-demo")!.enabled = false; });
  assert.equal((await ecommerceConfig.execute()).enabled, false);
  assert.equal((await new GetPublicStorefrontConfigService(repositories).execute(publicStorefrontSlug)).storeEnabled, false);
  assert.equal(await reports.authorizeExport(), "tenant-demo");
  const reportDataBeforeRemoval = await reports.execute();
  assert(reportDataBeforeRemoval.sales.length + reportDataBeforeRemoval.purchases.length + reportDataBeforeRemoval.movements.length + reportDataBeforeRemoval.payments.length > 0);
  await manage.execute("tenant-demo", ["ecommerce_delivery"], permissions, "user-admin");
  const baseCapabilities = (await new ResolveTenantEntitlementsService(repositories).execute("tenant-demo")).effectiveCapabilities;
  assert(isNavigationItemEntitled(reportsNav, (key) => hasCapability(key, baseCapabilities)));
  assert.deepEqual(await reports.execute(), reportDataBeforeRemoval);
  await assert.rejects(() => reports.authorizeExport(), (error: unknown) => error instanceof SaasEntitlementError && error.code === "CAPABILITY_REQUIRED");
  const originalRolePermissions = (await repositories.roles.getByIdScoped("tenant-demo", "role-admin"))!.permissions;
  store.mutate((db) => { db.roles.find((role) => role.id === "role-admin")!.permissions = originalRolePermissions.filter((permission) => !permission.startsWith("admin.reports.")); });
  assert(!isNavigationItemPermitted(reportsNav, new Set(originalRolePermissions.filter((permission) => !permission.startsWith("admin.reports.")))));
  await assert.rejects(() => reports.execute());
  await assert.rejects(() => reports.authorizeExport());
  store.mutate((db) => { db.roles.find((role) => role.id === "role-admin")!.permissions = originalRolePermissions; });
  actorUserId = "another-user";
  const otherTenantReports = await reports.execute();
  assert.equal(otherTenantReports.tenantId, "another-tenant");
  assert.deepEqual(otherTenantReports.sales, []);
  assert.deepEqual(otherTenantReports.purchases, []);
  assert.deepEqual(otherTenantReports.movements, []);
  assert.deepEqual(otherTenantReports.payments, []);
  await assert.rejects(() => reports.authorizeExport(), (error: unknown) => error instanceof SaasEntitlementError && error.code === "CAPABILITY_REQUIRED");
  actorUserId = "user-admin";
  await manage.execute("tenant-demo", [], permissions, "user-admin");
  const onlyBaseCapabilities = (await new ResolveTenantEntitlementsService(repositories).execute("tenant-demo")).effectiveCapabilities;
  assert(isNavigationItemPermitted(reportsNav, new Set(adminPermissions)) && isNavigationItemEntitled(reportsNav, (key) => hasCapability(key, onlyBaseCapabilities)));
  assert.deepEqual(await reports.execute(), reportDataBeforeRemoval);
  await assert.rejects(() => reports.authorizeExport(), (error: unknown) => error instanceof SaasEntitlementError && error.code === "CAPABILITY_REQUIRED");
  await assert.rejects(() => manage.execute("tenant-demo", ["advanced_reports"], ["admin.plans.read"], "user-admin"));
  await assert.rejects(() => manage.execute("tenant-demo", ["invalid"], permissions, "user-admin"));
  assert.deepEqual(await repositories.tenantSubscriptions.listInvoices("another-tenant"), []);
  console.log("verify-subscription-catalog: ALL PASS");
}

void main();
