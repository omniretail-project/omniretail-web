/**
 * Harness focalizado del boundary público `/contratar`.
 *
 * Uso:
 *   npx tsx scripts/verify-public-tenant-contracting.ts
 */
import assert from "node:assert/strict";
import { permissionsConfig } from "@/config/permissions";
import type { AuthAccount } from "@/core/entities";
import {
  AccountStatus,
  BranchStatus,
  SaasCapabilityKey,
  TenantSubscriptionStatus,
  UserType,
} from "@/core/enums";
import { BASE_PLAN_ID } from "@/core/subscription/catalog";
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
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import type { CreatePublicContractInputDto } from "@/modules/contracting/application/dto/PublicContractDto";
import {
  CreatePublicContractService,
  PublicContractError,
  deriveTenantSlug,
} from "@/modules/contracting/application/services/CreatePublicContractService";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

const PASSWORD_A = "ContratoSeguroA1!";
const PASSWORD_B = "ContratoSeguroB1!";

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

class FailingTenantOnboardingRepository extends MockTenantOnboardingRepository {
  protected override pushAuthAccount(): AuthAccount {
    throw new Error("Simulated public contracting failure");
  }
}

function createRepositories(
  store: MockDatabaseStore,
  eventBus: DataEventBus,
  sessionStorage: MemoryStorageAdapter,
  onboarding = new MockTenantOnboardingRepository(store, eventBus),
): RepositoryRegistry {
  return {
    tenants: new MockTenantRepository(store, eventBus),
    tenantOnboarding: onboarding,
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
}

function createHarness() {
  const persistence = new MemoryStorageAdapter();
  const sessionStorage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(persistence);
  const eventBus = new DataEventBus();
  const repositories = createRepositories(store, eventBus, sessionStorage);
  return { persistence, sessionStorage, store, eventBus, repositories };
}

function contractInput(
  businessName: string,
  adminEmail: string,
  adminPassword: string,
): CreatePublicContractInputDto {
  return {
    businessName,
    adminName: `Administradora ${businessName}`,
    adminEmail,
    adminPassword,
  };
}

async function expectPublicError(
  promise: Promise<unknown>,
  code: PublicContractError["code"],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PublicContractError);
    assert.equal(error.code, code);
    return true;
  });
}

async function verifyContractsIsolationEntitlementsAndLogin() {
  const harness = createHarness();
  const service = new CreatePublicContractService(harness.repositories);

  const inputA = contractInput("Ferretería Alfa", "ADMIN-A@EXAMPLE.TEST", PASSWORD_A);
  const inputB = contractInput("Ferretería Beta", "admin-b@example.test", PASSWORD_B);
  const resultA = await service.execute(inputA);
  const resultB = await service.execute(inputB);

  assert.notEqual(resultA.tenantId, resultB.tenantId, "Tenant A y B deben ser distintos");
  assert.notEqual(resultA.tenantId, "tenant-demo", "Tenant A nunca reutiliza tenant-demo");
  assert.notEqual(resultB.tenantId, "tenant-demo", "Tenant B nunca reutiliza tenant-demo");
  assert.equal(resultA.tenantSlug, "ferreteria-alfa", "el slug se deriva y normaliza");
  assert.equal(resultB.tenantSlug, "ferreteria-beta", "el slug B se deriva y normaliza");
  assert.equal(resultA.planId, BASE_PLAN_ID);
  assert.equal(resultB.planId, BASE_PLAN_ID);

  const snapshot = harness.store.getSnapshot();
  for (const [result, expectedEmail] of [
    [resultA, "admin-a@example.test"],
    [resultB, "admin-b@example.test"],
  ] as const) {
    const tenantId = result.tenantId;
    const branches = await harness.repositories.branches.listByTenant(tenantId);
    const roles = await harness.repositories.roles.listByTenant(tenantId);
    const users = await harness.repositories.users.listByTenant(tenantId);
    const subscription = await harness.repositories.tenantSubscriptions.getByTenantId(tenantId);
    const capabilities = await harness.repositories.businessConfig.getCapabilities(tenantId);
    const ecommerce = await harness.repositories.businessConfig.getEcommerceConfig(tenantId);

    assert.equal(branches.length, 1);
    assert.equal(branches[0].code, "MATRIZ");
    assert.equal(branches[0].name, "Matriz");
    assert.equal(branches[0].status, BranchStatus.active);
    assert.equal(roles.length, 2, "el onboarding aprovisiona Administrador y Cliente");
    const administratorRole = roles.find((role) => role.isSystem && role.name === "Administrador");
    const customerRole = roles.find((role) => role.isSystem && role.name === "Cliente");
    assert.ok(administratorRole, "debe existir el rol canónico Administrador");
    assert.ok(customerRole, "debe existir el rol canónico Cliente");
    const administratorPermissions = permissionsConfig
      .filter((permission) => permission.module !== "customer" && permission.module !== "storefront")
      .map((permission) => permission.key);
    const customerSelfServicePermissions = permissionsConfig
      .filter((permission) => permission.module === "customer" || permission.module === "storefront")
      .map((permission) => permission.key);
    assert.deepEqual(
      [...administratorRole.permissions].sort(),
      [...administratorPermissions].sort(),
      "el Administrador usa el catálogo canónico de permisos de empleado",
    );
    assert.deepEqual(
      [...customerRole.permissions].sort(),
      [...customerSelfServicePermissions].sort(),
      "el Cliente conserva el catálogo canónico de autoservicio",
    );
    assert.equal(users.length, 1);
    assert.equal(users[0].email, expectedEmail);
    assert.equal(users[0].type, UserType.employee);
    assert.equal(users[0].roleId, administratorRole.id);
    assert.deepEqual(users[0].allowedBranchIds, [branches[0].id]);
    assert.equal(subscription?.planId, BASE_PLAN_ID);
    assert.equal(subscription?.status, TenantSubscriptionStatus.active);
    assert.deepEqual(subscription?.addonCodes, [], "los addons nacen vacíos");
    assert.ok(capabilities, "BusinessCapabilitiesConfig debe existir");
    assert.equal(ecommerce?.enabled, false, "EcommerceConfig inicia deshabilitado");

    const account = snapshot.authAccounts.find((item) => item.userId === users[0].id);
    assert.equal(account?.status, AccountStatus.active);

    const entitlements = await new ResolveTenantEntitlementsService(harness.repositories).execute(
      tenantId,
    );
    const plan = await harness.repositories.plans.getById(BASE_PLAN_ID);
    assert.deepEqual(
      [...entitlements.effectiveCapabilities].sort(),
      [...(plan?.capabilities ?? [])].sort(),
      "los entitlements efectivos vienen del PlanDefinition",
    );
    assert.ok(entitlements.effectiveCapabilities.includes(SaasCapabilityKey.inventory));
    assert.ok(entitlements.effectiveCapabilities.includes(SaasCapabilityKey.pos));
    assert.ok(!entitlements.effectiveCapabilities.includes(SaasCapabilityKey.ecommerce));
    assert.ok(!entitlements.effectiveCapabilities.includes(SaasCapabilityKey.advancedReports));

    for (const table of [
      snapshot.products,
      snapshot.categories,
      snapshot.inventoryBalances,
      snapshot.suppliers,
      snapshot.purchaseOrders,
      snapshot.receipts,
      snapshot.sales,
      snapshot.customers,
      snapshot.orders,
      snapshot.payments,
    ]) {
      assert.equal(
        table.filter((item) => item.tenantId === tenantId).length,
        0,
        "un Tenant contratado no recibe datos operativos ni pagos",
      );
    }
  }

  const [userA] = await harness.repositories.users.listByTenant(resultA.tenantId);
  const [userB] = await harness.repositories.users.listByTenant(resultB.tenantId);
  const [branchA] = await harness.repositories.branches.listByTenant(resultA.tenantId);
  const [branchB] = await harness.repositories.branches.listByTenant(resultB.tenantId);
  const [roleA] = await harness.repositories.roles.listByTenant(resultA.tenantId);
  const [roleB] = await harness.repositories.roles.listByTenant(resultB.tenantId);

  assert.equal(await harness.repositories.users.getByIdScoped(resultA.tenantId, userB.id), null);
  assert.equal(await harness.repositories.users.getByIdScoped(resultB.tenantId, userA.id), null);
  assert.equal(
    await harness.repositories.branches.getByIdScoped(resultA.tenantId, branchB.id),
    null,
  );
  assert.equal(
    await harness.repositories.branches.getByIdScoped(resultB.tenantId, branchA.id),
    null,
  );
  assert.equal(await harness.repositories.roles.getByIdScoped(resultA.tenantId, roleB.id), null);
  assert.equal(await harness.repositories.roles.getByIdScoped(resultB.tenantId, roleA.id), null);

  const loginA = await harness.repositories.auth.login({
    email: inputA.adminEmail,
    passwordMock: PASSWORD_A,
    expectedUserType: UserType.employee,
  });
  assert.equal(loginA.status, "authenticated");
  if (loginA.status === "authenticated") {
    assert.equal(loginA.session.userId, userA.id);
    assert.equal(
      (await harness.repositories.users.getById(loginA.session.userId))?.tenantId,
      resultA.tenantId,
    );
  }

  const loginB = await harness.repositories.auth.login({
    email: inputB.adminEmail,
    passwordMock: PASSWORD_B,
    expectedUserType: UserType.employee,
  });
  assert.equal(loginB.status, "authenticated");
  if (loginB.status === "authenticated") {
    assert.equal(loginB.session.userId, userB.id);
    assert.equal(
      (await harness.repositories.users.getById(loginB.session.userId))?.tenantId,
      resultB.tenantId,
    );
  }

  return { harness, resultA, resultB };
}

async function verifyMaliciousInputAndValidation() {
  const harness = createHarness();
  const service = new CreatePublicContractService(harness.repositories);
  const malicious = {
    ...contractInput("Ferretería Hostil", "hostile@example.test", "HostilePass1!"),
    tenantId: "tenant-demo",
    tenantSlug: "tenant-demo",
    branchId: "branch-centro",
    roleId: "role-admin",
    planId: "plan-enterprise",
    addonCodes: ["ecommerce_delivery", "advanced_reports"],
    capabilities: [SaasCapabilityKey.ecommerce, SaasCapabilityKey.advancedReports],
    adminPermissions: ["invented.superuser"],
    subscriptionStatus: "active",
  } as CreatePublicContractInputDto;

  const result = await service.execute(malicious);
  assert.notEqual(result.tenantId, "tenant-demo");
  assert.equal(result.tenantSlug, "ferreteria-hostil");
  assert.equal(result.planId, BASE_PLAN_ID);

  const subscription = await harness.repositories.tenantSubscriptions.getByTenantId(
    result.tenantId,
  );
  assert.deepEqual(subscription?.addonCodes, []);
  const roles = await harness.repositories.roles.listByTenant(result.tenantId);
  const role = roles.find((candidate) => candidate.isSystem && candidate.name === "Administrador");
  assert.ok(role, "el onboarding hostil debe conservar un Administrador canónico");
  const [branch] = await harness.repositories.branches.listByTenant(result.tenantId);
  assert.notEqual(role.id, "role-admin");
  assert.notEqual(branch.id, "branch-centro");
  assert.deepEqual(
    [...role.permissions].sort(),
    permissionsConfig
      .filter((permission) => permission.module !== "customer" && permission.module !== "storefront")
      .map((permission) => permission.key)
      .sort(),
  );

  await expectPublicError(
    service.execute(contractInput("", "missing@example.test", "MissingPass1!")),
    "INCOMPLETE_DATA",
  );
  await expectPublicError(
    service.execute(contractInput("Correo inválido", "no-es-correo", "MissingPass1!")),
    "INVALID_EMAIL",
  );
  await expectPublicError(
    service.execute(contractInput("Clave inválida", "password@example.test", "12345678")),
    "INVALID_PASSWORD",
  );
  assert.equal(deriveTenantSlug("  Ferretería Los Simpson  "), "ferreteria-los-simpson");
}

async function verifyDuplicatesAndConcurrentSubmit() {
  const harness = createHarness();
  const service = new CreatePublicContractService(harness.repositories);
  const first = contractInput("Negocio Único", "unique@example.test", "UniquePass1!");
  await service.execute(first);
  const afterFirst = harness.store.getSnapshot();

  await expectPublicError(
    service.execute(contractInput("Otro negocio", "UNIQUE@EXAMPLE.TEST", "OtherSecure1!")),
    "EMAIL_ALREADY_REGISTERED",
  );
  await expectPublicError(
    service.execute(contractInput("Negocio Unico", "other@example.test", "OtherSecure1!")),
    "SLUG_COLLISION",
  );

  const afterDuplicates = harness.store.getSnapshot();
  assert.equal(afterDuplicates.tenants.length, afterFirst.tenants.length);
  assert.equal(afterDuplicates.users.length, afterFirst.users.length);
  assert.equal(afterDuplicates.authAccounts.length, afterFirst.authAccounts.length);
  assert.equal(afterDuplicates.tenantSubscriptions.length, afterFirst.tenantSubscriptions.length);

  const concurrentInput = contractInput(
    "Negocio Concurrente",
    "concurrent@example.test",
    "ConcurrentPass1!",
  );
  const concurrent = await Promise.allSettled([
    service.execute(concurrentInput),
    service.execute(concurrentInput),
  ]);
  assert.equal(concurrent.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((item) => item.status === "rejected").length, 1);
  assert.equal(
    (await harness.repositories.tenants.getAll()).filter(
      (tenant) => tenant.slug === "negocio-concurrente",
    ).length,
    1,
  );
}

async function verifyRollbackAndRetry() {
  const harness = createHarness();
  const input = contractInput("Rollback Público", "rollback@example.test", "RollbackPass1!");
  const before = harness.store.getSnapshot();
  const failingRepositories = createRepositories(
    harness.store,
    harness.eventBus,
    harness.sessionStorage,
    new FailingTenantOnboardingRepository(harness.store, harness.eventBus),
  );

  await expectPublicError(
    new CreatePublicContractService(failingRepositories).execute(input),
    "ONBOARDING_FAILED",
  );
  const afterFailure = harness.store.getSnapshot();
  for (const key of [
    "tenants",
    "branches",
    "roles",
    "users",
    "authAccounts",
    "businessCapabilities",
    "ecommerceConfigs",
    "tenantSubscriptions",
  ] as const) {
    assert.equal(afterFailure[key].length, before[key].length, `${key} debe hacer rollback`);
  }

  const retry = await new CreatePublicContractService(harness.repositories).execute(input);
  assert.ok(await harness.repositories.tenants.getById(retry.tenantId));
}

async function verifyPersistence(
  harness: ReturnType<typeof createHarness>,
  tenantIds: readonly string[],
) {
  const reloadedStore = new MockDatabaseStore(harness.persistence);
  const reloaded = reloadedStore.getSnapshot();
  for (const tenantId of tenantIds) {
    assert.ok(reloaded.tenants.some((tenant) => tenant.id === tenantId));
    assert.ok(
      reloaded.tenantSubscriptions.some((subscription) => subscription.tenantId === tenantId),
    );
  }
  assert.ok(reloaded.tenants.some((tenant) => tenant.id === "tenant-demo"));
}

async function main() {
  const { harness, resultA, resultB } = await verifyContractsIsolationEntitlementsAndLogin();
  await verifyMaliciousInputAndValidation();
  await verifyDuplicatesAndConcurrentSubmit();
  await verifyRollbackAndRetry();
  await verifyPersistence(harness, [resultA.tenantId, resultB.tenantId]);

  console.log("PASS public tenant contracting: A + B, isolation, entitlements, login");
  console.log("PASS malicious input, duplicates/concurrency, rollback/retry, persistence");
  console.log("PASS no addons, no ecommerce, no advanced reports, no payment/demo data");
}

void main();
