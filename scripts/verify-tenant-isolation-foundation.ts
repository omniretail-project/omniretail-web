import assert from "node:assert/strict";
import { AccountStatus, TenantStatus, UserType } from "@/core/enums";
import { canUserAccessBranch } from "@/core/scopes/userBranchAccess";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBranchRepository,
  MockAuthRepository,
  MockCategoryRepository,
  MockProductMediaRepository,
  MockProductRepository,
  MockPromotionRepository,
  MockRoleRepository,
  MockTenantRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import { buildPasswordHashMock } from "@/infrastructure/mock/shared/passwordHashMock";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import { ArchiveProductService } from "@/modules/catalog/application/services/ArchiveProductService";
import { CatalogServiceError } from "@/modules/catalog/application/services/serviceHelpers";
import { GetCategoriesService } from "@/modules/catalog/application/services/GetCategoriesService";
import { GetProductDetailService } from "@/modules/catalog/application/services/GetProductDetailService";
import {
  GetProductsService,
  type GetProductsParams,
} from "@/modules/catalog/application/services/GetProductsService";
import { GetUnitsService } from "@/modules/catalog/application/services/GetUnitsService";

const TENANT_A = "tenant-demo";
const TENANT_B = "tenant-isolation-b";
const TENANT_INACTIVE = "tenant-isolation-inactive";
const PRODUCT_LIST_PARAMS: GetProductsParams = {
  page: 1,
  pageSize: 100,
  sort: "name,asc",
  filters: {
    search: "",
    status: "all",
    productType: "all",
    categoryId: "all",
    channels: [],
    promotion: "all",
  },
};

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

function createHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const original = store.getSnapshot();
  const tenantA = original.tenants.find((tenant) => tenant.id === TENANT_A);
  const branchA = original.branches.find((branch) => branch.tenantId === TENANT_A);
  const roleA = original.roles.find((role) => role.tenantId === TENANT_A);
  const employeeA = original.users.find(
    (user) => user.tenantId === TENANT_A && user.type === UserType.employee && user.roleId,
  );
  const categoryA = original.categories.find((category) => category.tenantId === TENANT_A);
  const unitA = original.units.find((unit) => unit.tenantId === TENANT_A);
  const productA = original.products.find((product) => product.tenantId === TENANT_A);
  assert.ok(tenantA && branchA && roleA && employeeA && categoryA && unitA && productA);

  const now = new Date().toISOString();
  const branchB = { ...branchA, id: "branch-isolation-b", tenantId: TENANT_B, name: "Branch B" };
  const categoryB = {
    ...categoryA,
    id: "category-isolation-b",
    tenantId: TENANT_B,
    name: "Category B",
    slug: "category-b",
  };
  const unitB = {
    ...unitA,
    id: "unit-isolation-b",
    tenantId: TENANT_B,
    name: "Unit B",
    code: "UNIT-B",
  };
  const productB = {
    ...productA,
    id: "product-isolation-b",
    tenantId: TENANT_B,
    categoryId: categoryB.id,
    baseUnitId: unitB.id,
    saleUnitId: unitB.id,
    sku: "TENANT-B-ONLY",
    name: "Product B",
  };
  const roleB = {
    ...roleA,
    id: "role-isolation-b",
    tenantId: TENANT_B,
    name: "Role B",
    branchScope: "all" as const,
  };
  const employeeB = {
    ...employeeA,
    id: "user-isolation-b",
    tenantId: TENANT_B,
    roleId: roleB.id,
    branchId: branchB.id,
    allowedBranchIds: [branchB.id],
    email: "employee-b@tenant.test",
    name: "Employee B",
  };
  const inactiveRole = {
    ...roleB,
    id: "role-isolation-inactive",
    tenantId: TENANT_INACTIVE,
  };
  const inactiveEmployee = {
    ...employeeB,
    id: "user-isolation-inactive",
    tenantId: TENANT_INACTIVE,
    roleId: inactiveRole.id,
    email: "inactive@tenant.test",
  };
  const customer = {
    ...employeeB,
    id: "customer-isolation-b",
    type: UserType.customer,
    roleId: undefined,
    branchId: undefined,
    allowedBranchIds: undefined,
    email: "customer-b@tenant.test",
  };

  store.mutate((db) => {
    db.tenants.push(
      { ...tenantA, id: TENANT_B, slug: "tenant-b", name: "Tenant B" },
      {
        ...tenantA,
        id: TENANT_INACTIVE,
        slug: "tenant-inactive",
        name: "Tenant inactive",
        status: TenantStatus.inactive,
      },
    );
    db.branches.push(branchB);
    db.categories.push(categoryB);
    db.units.push(unitB);
    db.products.push(productB);
    db.roles.push(roleB, inactiveRole);
    db.users.push(employeeB, inactiveEmployee, customer);
    db.authAccounts.push(
      {
        id: "auth-isolation-b",
        userId: employeeB.id,
        email: employeeB.email,
        passwordHashMock: buildPasswordHashMock("TenantTest123"),
        status: AccountStatus.active,
        failedLoginAttempts: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "auth-isolation-inactive",
        userId: inactiveEmployee.id,
        email: inactiveEmployee.email,
        passwordHashMock: buildPasswordHashMock("TenantTest123"),
        status: AccountStatus.active,
        failedLoginAttempts: 0,
        createdAt: now,
        updatedAt: now,
      },
    );
  });

  let currentUserId = employeeA.id;
  const session = {
    id: "tenant-isolation-session",
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    rememberMe: false,
  };
  const repositories = {
    productDataSource: "mock",
    auth: {
      getCurrentSessionId: async () => session.id,
      getSession: async (sessionId: string) =>
        sessionId === session.id ? { ...session, userId: currentUserId } : null,
    },
    branches: new MockBranchRepository(store, eventBus),
    categories: new MockCategoryRepository(store, eventBus),
    productMedia: new MockProductMediaRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    promotions: new MockPromotionRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return {
    entities: {
      branchA,
      branchB,
      categoryA,
      categoryB,
      customer,
      employeeA,
      employeeB,
      inactiveEmployee,
      productA,
      productB,
      roleA,
      roleB,
      unitA,
      unitB,
    },
    original,
    repositories,
    setCurrentUser(userId: string) {
      currentUserId = userId;
    },
    storage,
    store,
  };
}

async function verifyCatalogIsolation(harness: ReturnType<typeof createHarness>) {
  const { entities, repositories } = harness;
  const assertVisibleTenant = async (tenantId: string) => {
    const [productPage, categories, units] = await Promise.all([
      new GetProductsService(repositories).execute(PRODUCT_LIST_PARAMS),
      new GetCategoriesService(repositories).execute(),
      new GetUnitsService(repositories).execute(),
    ]);
    const products = productPage.items;
    assert.ok(products.length > 0 && products.every((item) => item.tenantId === tenantId));
    assert.ok(categories.length > 0 && categories.every((item) => item.tenantId === tenantId));
    assert.ok(units.length > 0 && units.every((item) => item.tenantId === tenantId));
  };

  await assertVisibleTenant(TENANT_A);
  harness.setCurrentUser(entities.employeeB.id);
  await assertVisibleTenant(TENANT_B);
  assert.equal(await new GetProductDetailService(repositories).execute(entities.productA.id), null);
  assert.equal(await repositories.categories.getByIdScoped(TENANT_B, entities.categoryA.id), null);
  assert.equal(await repositories.units.getByIdScoped(TENANT_B, entities.unitA.id), null);
  // El tenant B no puede archivar un producto del tenant A: ArchiveProductService normaliza el
  // "not found" del repository scoped a CatalogServiceError, sin revelar datos del otro tenant.
  await assert.rejects(
    new ArchiveProductService(repositories).execute(entities.productA.id),
    (error: unknown) => {
      assert.ok(error instanceof CatalogServiceError);
      assert.equal(error.message, "El producto solicitado no existe.");
      assert.ok(!error.message.includes(entities.productA.name));
      return true;
    },
  );
  await assert.rejects(
    repositories.categories.updateScoped(TENANT_B, entities.categoryA.id, { name: "intrusion" }),
  );
  await assert.rejects(
    repositories.units.updateScoped(TENANT_B, entities.unitA.id, { name: "intrusion" }),
  );
  assert.equal(
    (await repositories.products.getById(entities.productA.id))?.name,
    entities.productA.name,
  );
}

async function verifyBranchIsolation(harness: ReturnType<typeof createHarness>) {
  const { branchA, branchB, employeeB, roleB } = harness.entities;
  const tenantBranches = await harness.repositories.branches.getActiveByTenant(TENANT_B);
  assert.deepEqual(
    tenantBranches.map((branch) => branch.id),
    [branchB.id],
  );
  assert.equal(canUserAccessBranch(employeeB, roleB, branchB), true);
  assert.equal(canUserAccessBranch(employeeB, roleB, branchA), false);

  const selectedRole = { ...roleB, branchScope: "selected" as const };
  const selectedUser = {
    ...employeeB,
    allowedBranchIds: [branchB.id, branchA.id],
  };
  assert.equal(canUserAccessBranch(selectedUser, selectedRole, branchB), true);
  assert.equal(canUserAccessBranch(selectedUser, selectedRole, branchA), false);
}

async function verifySessionIsolation(harness: ReturnType<typeof createHarness>) {
  harness.setCurrentUser(harness.entities.employeeB.id);
  assert.equal(
    (await resolveCurrentSessionSnapshot(harness.repositories)).user?.id,
    harness.entities.employeeB.id,
  );

  harness.store.mutate((db) => {
    const user = db.users.find((item) => item.id === harness.entities.employeeB.id);
    assert.ok(user);
    user.roleId = harness.entities.roleA.id;
  });
  assert.equal((await resolveCurrentSessionSnapshot(harness.repositories)).user, null);
  const operationalAuth = new MockAuthRepository(
    harness.store,
    new DataEventBus(),
    new MemoryStorageAdapter(),
  );
  await assert.rejects(
    operationalAuth.login({
      email: harness.entities.employeeB.email,
      passwordMock: "TenantTest123",
      expectedUserType: UserType.employee,
    }),
  );

  harness.setCurrentUser(harness.entities.inactiveEmployee.id);
  assert.equal((await resolveCurrentSessionSnapshot(harness.repositories)).user, null);
  await assert.rejects(
    operationalAuth.login({
      email: harness.entities.inactiveEmployee.email,
      passwordMock: "TenantTest123",
      expectedUserType: UserType.employee,
    }),
  );

  harness.setCurrentUser(harness.entities.customer.id);
  assert.equal(
    (await resolveCurrentSessionSnapshot(harness.repositories)).user?.id,
    harness.entities.customer.id,
  );
}

function verifyFerrePharmaPreserved(harness: ReturnType<typeof createHarness>) {
  const current = harness.store.getSnapshot();
  const onlyTenantA = <T extends { tenantId: string }>(items: T[]) =>
    items.filter((item) => item.tenantId === TENANT_A);
  assert.deepEqual(onlyTenantA(current.products), onlyTenantA(harness.original.products));
  assert.deepEqual(onlyTenantA(current.categories), onlyTenantA(harness.original.categories));
  assert.deepEqual(onlyTenantA(current.units), onlyTenantA(harness.original.units));
  assert.deepEqual(onlyTenantA(current.branches), onlyTenantA(harness.original.branches));

  const reloaded = new MockDatabaseStore(harness.storage).getSnapshot();
  assert.ok(reloaded.products.some((product) => product.id === harness.entities.productB.id));
  assert.deepEqual(onlyTenantA(reloaded.products), onlyTenantA(harness.original.products));
}

async function main() {
  const harness = createHarness();
  await verifyCatalogIsolation(harness);
  console.log("catalog tenant isolation: PASS");
  await verifyBranchIsolation(harness);
  console.log("branch tenant isolation: PASS");
  await verifySessionIsolation(harness);
  console.log("session tenant invariants and customer regression: PASS");
  verifyFerrePharmaPreserved(harness);
  console.log("FerrePharma preservation and no automatic reset: PASS");
}

void main();
