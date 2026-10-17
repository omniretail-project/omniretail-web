import assert from "node:assert/strict";
import { CategoryStatus, RoleStatus, UserStatus, UserType } from "@/core/enums";
import { canUserAccessBranch, isBranchIdInUserScope } from "@/core/scopes/userBranchAccess";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBranchRepository,
  MockCategoryRepository,
  MockPlanRepository,
  MockProductRepository,
  MockRoleRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { GetCategoriesService } from "@/modules/catalog/application/services/GetCategoriesService";
import { SaveCategoryService } from "@/modules/catalog/application/services/SaveCategoryService";
import { CatalogServiceError } from "@/modules/catalog/application/services/serviceHelpers";
import { catalogNavigation } from "@/modules/catalog/navigation";
import { requireCashContext } from "@/modules/pos/application/services/cashShiftServiceContext";
import { isNavigationItemPermitted } from "@/shared/navigation/Sidebar";

const TENANT_A = "tenant-demo";
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

function createHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();

  const snapshot = store.getSnapshot();
  const cashierRole = snapshot.roles.find((role) => role.id === "role-cashier");
  const branchCentro = snapshot.branches.find((branch) => branch.id === "branch-centro");
  const branchNorte = snapshot.branches.find((branch) => branch.id === "branch-norte");
  assert.ok(cashierRole && branchCentro && branchNorte);
  assert.equal(cashierRole.branchScope, "assigned", "fixture: role-cashier debe ser branchScope=assigned");

  // Empleado dado de alta como CreateEmployeeService realmente lo hace hoy: allowedBranchIds
  // seteado, branchId NUNCA seteado (ver serviceHelpers/CreateEmployeeService, admin-users #92).
  const newEmployee = {
    id: "user-hardening-new-cashier",
    tenantId: TENANT_A,
    name: "Cajero Nuevo",
    email: "cajero-nuevo@hardening.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: cashierRole.id,
    allowedBranchIds: [branchCentro.id],
    createdAt: NOW,
    updatedAt: NOW,
  };

  // Empleado legacy (cuenta semilla real: cajero/bodeguero del demo seed) -- branchId seteado,
  // allowedBranchIds NUNCA seteado. Debe seguir funcionando igual que antes del fix.
  const legacyEmployee = {
    id: "user-hardening-legacy-cashier",
    tenantId: TENANT_A,
    name: "Cajero Legacy",
    email: "cajero-legacy@hardening.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: cashierRole.id,
    branchId: branchCentro.id,
    createdAt: NOW,
    updatedAt: NOW,
  };

  store.mutate((db) => {
    db.users.push(newEmployee, legacyEmployee);
  });

  const repositories = {
    users: new MockUserRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    branches: new MockBranchRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return { repositories, cashierRole, branchCentro, branchNorte, newEmployee, legacyEmployee };
}

function verifyNewEmployeeGrantedOwnBranch() {
  const { cashierRole, branchCentro, branchNorte, newEmployee } = createHarness();

  // ANTES del fix esto era FALSE: branchScope="assigned" caía a
  // `user.branchId === branchId`, y CreateEmployeeService nunca setea branchId.
  assert.equal(
    canUserAccessBranch(newEmployee, cashierRole, branchCentro),
    true,
    "un empleado nuevo (allowedBranchIds, sin branchId) debe acceder a SU sucursal asignada",
  );
  assert.equal(
    canUserAccessBranch(newEmployee, cashierRole, branchNorte),
    false,
    "el mismo empleado NO debe acceder a una sucursal fuera de allowedBranchIds",
  );
}

function verifyLegacyEmployeeStillWorks() {
  const { cashierRole, branchCentro, legacyEmployee } = createHarness();

  assert.equal(
    canUserAccessBranch(legacyEmployee, cashierRole, branchCentro),
    true,
    "una cuenta legacy (branchId, sin allowedBranchIds) debe seguir funcionando igual que antes",
  );
}

function verifyCrossTenantStillDenied() {
  const { cashierRole, branchCentro, newEmployee } = createHarness();
  const otherTenantUser = { ...newEmployee, tenantId: "tenant-other" };

  assert.equal(
    isBranchIdInUserScope(otherTenantUser, cashierRole, branchCentro.id),
    false,
    "cross-tenant sigue denegado independientemente de allowedBranchIds",
  );
}

function verifyAllScopeStillBypasses() {
  const { cashierRole, branchCentro, branchNorte, newEmployee } = createHarness();
  const allScopeRole = { ...cashierRole, branchScope: "all" as const };
  const employeeWithNoBranches = { ...newEmployee, allowedBranchIds: [] };

  assert.equal(
    canUserAccessBranch(employeeWithNoBranches, allScopeRole, branchCentro),
    true,
    "branchScope=all sigue siendo bypass total, sin importar allowedBranchIds",
  );
  assert.equal(canUserAccessBranch(employeeWithNoBranches, allScopeRole, branchNorte), true);
}

async function verifyEndToEndCashContext() {
  const { repositories, newEmployee, branchCentro } = createHarness();

  // Camino real: requireCashContext es lo que POS invoca para abrir/cerrar turno de caja. Antes
  // del fix, esto lanzaba "No tienes acceso a la sucursal seleccionada." para CUALQUIER
  // empleado dado de alta por Admin Users con rol cajero/bodeguero.
  const context = await requireCashContext(
    repositories,
    { tenantId: TENANT_A, actorUserId: newEmployee.id, branchId: branchCentro.id },
    "pos.cash.open",
  );
  assert.equal(context.user.id, newEmployee.id);
  assert.equal(context.branch.id, branchCentro.id);
}

// ==================================================
// Hallazgo 2: Categorias/Ubicaciones/Unidades (Catalog) no tenian NINGUN permiso .read ni
// verificacion a nivel de aplicacion -- la unica barrera era el nav, y widening el nav sin esto
// hubiera dejado a un usuario read-only con botones de mutacion que SI funcionaban.
// ==================================================

function createCatalogHarness(permissions: string[]) {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();

  const testRole = {
    id: "role-hardening-catalog",
    tenantId: TENANT_A,
    name: "Role hardening test",
    isSystem: false,
    permissions,
    branchScope: "all" as const,
    status: RoleStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const testUser = {
    id: "user-hardening-catalog",
    tenantId: TENANT_A,
    name: "Catalog Hardening Tester",
    email: "catalog-hardening@hardening.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: testRole.id,
    createdAt: NOW,
    updatedAt: NOW,
  };
  store.mutate((db) => {
    db.roles.push(testRole);
    db.users.push(testUser);
  });

  const session = { id: "session-hardening-catalog", userId: testUser.id };
  const repositories = {
    auth: {
      getCurrentSessionId: async () => session.id,
      getSession: async (sessionId: string) => (sessionId === session.id ? session : null),
    },
    users: new MockUserRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    categories: new MockCategoryRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return { repositories };
}

function buildCategoryDto() {
  return {
    name: "Categoria hardening",
    code: "hardening-cat",
    description: "",
    parentId: "",
    status: CategoryStatus.active,
  };
}

async function verifyCategoriesReadGuard() {
  const { repositories: noPermissions } = createCatalogHarness([]);
  await assert.rejects(
    new GetCategoriesService(noPermissions).execute(),
    CatalogServiceError,
    "10: sin catalog.categories.read/manage, GetCategoriesService debe fallar",
  );

  const { repositories: readOnly } = createCatalogHarness(["catalog.categories.read"]);
  await assert.doesNotReject(
    new GetCategoriesService(readOnly).execute(),
    "10: con catalog.categories.read, GetCategoriesService debe funcionar",
  );
}

async function verifyCategoriesManageGuard() {
  const { repositories: readOnly } = createCatalogHarness(["catalog.categories.read"]);
  await assert.rejects(
    new SaveCategoryService(readOnly).create(buildCategoryDto()),
    CatalogServiceError,
    "11: con SOLO catalog.categories.read (sin manage), SaveCategoryService.create debe fallar",
  );

  const { repositories: manage } = createCatalogHarness([
    "catalog.categories.read",
    "catalog.categories.manage",
  ]);
  const created = await new SaveCategoryService(manage).create(buildCategoryDto());
  assert.ok(created.id, "11: con catalog.categories.manage, create debe funcionar");
}

function verifyCatalogNavigationReadOnly() {
  const categoriesItem = catalogNavigation[0]?.children?.find(
    (item) => item.id === "catalog-categories",
  );
  const locationsItem = catalogNavigation[0]?.children?.find(
    (item) => item.id === "catalog-locations",
  );
  const unitsItem = catalogNavigation[0]?.children?.find((item) => item.id === "catalog-units");
  assert.ok(categoriesItem && locationsItem && unitsItem);

  // 12: mismo bug de nav que Users/Roles/Branches antes de #92 -- *.read solo ahora alcanza.
  assert.equal(
    isNavigationItemPermitted(categoriesItem, new Set(["catalog.categories.read"])),
    true,
  );
  assert.equal(isNavigationItemPermitted(categoriesItem, new Set([])), false);
  assert.equal(isNavigationItemPermitted(locationsItem, new Set(["catalog.locations.read"])), true);
  assert.equal(isNavigationItemPermitted(unitsItem, new Set(["catalog.units.read"])), true);
}

async function main() {
  verifyNewEmployeeGrantedOwnBranch();
  console.log("new employee (allowedBranchIds, sin branchId) accede a su sucursal: PASS");
  verifyLegacyEmployeeStillWorks();
  console.log("cuenta legacy (branchId, sin allowedBranchIds) sigue funcionando: PASS");
  verifyCrossTenantStillDenied();
  console.log("cross-tenant sigue denegado: PASS");
  verifyAllScopeStillBypasses();
  console.log("branchScope=all sigue siendo bypass total: PASS");
  await verifyEndToEndCashContext();
  console.log("requireCashContext (POS) end-to-end para empleado nuevo: PASS");
  await verifyCategoriesReadGuard();
  console.log("GetCategoriesService exige catalog.categories.read/manage: PASS");
  await verifyCategoriesManageGuard();
  console.log("SaveCategoryService exige catalog.categories.manage: PASS");
  verifyCatalogNavigationReadOnly();
  console.log("nav de catalog (categorias/ubicaciones/unidades) acepta *.read: PASS");
}

void main();
