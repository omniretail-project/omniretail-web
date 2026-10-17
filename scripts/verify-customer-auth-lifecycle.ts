import assert from "node:assert/strict";
import { UserType, AccountStatus } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockAuthRepository } from "@/infrastructure/mock/repositories/MockAuthRepository";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import {
  canUserEnterPrivateRoute,
  resolvePostLoginDestination,
  isCustomerAccountPath,
  isSafeCustomerReturnUrl
} from "@/modules/auth/application/services/postLoginNavigation";

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const rawValue = this.values.get(key);
    return rawValue === undefined ? null : (JSON.parse(rawValue) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

async function runLifecycleTests() {
  console.log("Running Customer Auth Lifecycle Harness...");

  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const auth = new MockAuthRepository(store, eventBus, storage);

  // SCENARIO 1: CUSTOMER REGISTRATION
  const tenantSlug = "ferrepharma-demo";
  const registerResult = await auth.registerCustomer({
    tenantSlug,
    name: "Customer Lifecycle",
    email: "lifecycle@example.com",
    phone: "12345678",
    passwordMock: "SecurePass123!",
  });

  assert.equal(registerResult.user.type, UserType.customer, "Customer is NOT Employee/Admin");
  assert.equal(registerResult.user.tenantId, "tenant-demo", "Customer tenantId == Tenant A");

  // SCENARIO 2: VERIFICATION
  const snapshot = store.getSnapshot();
  const verification = snapshot.emailVerifications.find((v) => v.userId === registerResult.user.id);
  assert.ok(verification, "Verification token created");

  // SCENARIO 3: VERIFICATION DESTINATION
  // The old `verifyEmail` returned void. The new one should return `{ tenantSlug?: string }` so VerifyEmailPage can redirect.
  // We'll call the real auth repository and see what it returns.
  const verifyResult = await auth.verifyEmail(verification.token);

  // Let's assert the new contract (so this will fail in RED phase if verifyEmail returns void)
  assert.ok(verifyResult, "verifyEmail should return a result object");
  assert.equal((verifyResult as { tenantSlug?: string }).tenantSlug, tenantSlug, "verifyEmail must return the correct tenantSlug");

  const verifiedAccount = store.getSnapshot().authAccounts.find((a) => a.userId === registerResult.user.id);
  assert.ok(verifiedAccount);
  assert.equal(verifiedAccount.status, AccountStatus.active, "Account becomes active");

  const verifiedUser = store.getSnapshot().users.find((u) => u.id === registerResult.user.id);
  assert.equal(verifiedUser?.tenantId, "tenant-demo", "tenantId remains Tenant A");
  assert.equal(verifiedUser?.type, UserType.customer, "identity remains Customer");

  // SCENARIO 4: CUSTOMER LOGIN
  const loginResult = await auth.login({
    tenantId: "tenant-demo",
    email: "lifecycle@example.com",
    passwordMock: "SecurePass123!"
  });
  assert.equal(loginResult.status, "authenticated", "Auth succeeds");
  if (loginResult.status === "authenticated") {
    const sessionUserId = loginResult.session.userId;
    const sessionUser = store.getSnapshot().users.find((u) => u.id === sessionUserId);
    assert.equal(sessionUser?.type, UserType.customer, "Returned identity is Customer");
    assert.equal(sessionUser?.tenantId, "tenant-demo", "Returned tenantId == Tenant A");
  }

  // SCENARIO 5: POST-LOGIN DESTINATION
  const dest = resolvePostLoginDestination(verifiedUser!, undefined, tenantSlug);
  assert.equal(dest, `/tienda/${tenantSlug}`, "Expected: /tienda/tenant-a");

  // SCENARIO 6: TENANT RETURN URL
  assert.ok(isSafeCustomerReturnUrl(`/tienda/${tenantSlug}/cuenta`, tenantSlug), "Allowed: /tienda/tenant-a/cuenta");
  assert.ok(!isSafeCustomerReturnUrl(`/tienda/tenant-b/cuenta`, tenantSlug), "Cross-tenant: denied/fallback");
  assert.ok(!isSafeCustomerReturnUrl(`https://evil.example.com`, tenantSlug), "External: denied/fallback");

  // SCENARIO 7: CUSTOMER ACCOUNT PATHS
  assert.equal(isCustomerAccountPath("/cuenta"), true);
  assert.equal(isCustomerAccountPath("/cuenta/pedidos"), true);
  assert.equal(isCustomerAccountPath(`/tienda/${tenantSlug}/cuenta`), true);
  assert.equal(isCustomerAccountPath(`/tienda/${tenantSlug}/cuenta/pedidos`), true);
  assert.equal(isCustomerAccountPath(`/tienda/${tenantSlug}/cuenta/perfil`), true);

  assert.equal(isCustomerAccountPath(`/tienda/${tenantSlug}/catalogo`), false);
  assert.equal(isCustomerAccountPath(`/tienda/${tenantSlug}/carrito`), false);
  assert.equal(isCustomerAccountPath(`/inicio`), false);
  assert.equal(isCustomerAccountPath(`/administracion/usuarios`), false);

  // SCENARIO 8: LEGACY CUSTOMER ROLE BACKFILL. Mutate persisted data into
  // the pre-normalization shape, then reconstruct the real store twice.
  const employeeBefore = store.getSnapshot().users.find((user) => user.type === UserType.employee);
  assert.ok(employeeBefore, "Seed employee exists");
  store.mutate((db) => {
    const legacyCustomer = db.users.find((user) => user.id === registerResult.user.id);
    assert.ok(legacyCustomer);
    legacyCustomer.roleId = undefined;
  });
  const normalizedOnce = new MockDatabaseStore(storage).getSnapshot();
  const repairedCustomer = normalizedOnce.users.find((user) => user.id === registerResult.user.id);
  const customerRoles = normalizedOnce.roles.filter(
    (role) => role.tenantId === registerResult.user.tenantId && role.isSystem &&
      role.permissions.includes("customer.account.read") &&
      !role.permissions.some((permission) => permission.startsWith("admin.") || permission.startsWith("pos.") || permission.startsWith("inventory.")),
  );
  assert.equal(customerRoles.length, 1, "Canonical Customer role remains singular");
  assert.equal(repairedCustomer?.roleId, customerRoles[0].id, "Legacy Customer roleId repaired");
  assert.ok(customerRoles[0].permissions.includes("storefront.orders.read"), "Canonical Customer permissions available");
  assert.equal(normalizedOnce.users.find((user) => user.id === employeeBefore.id)?.roleId, employeeBefore.roleId, "Employee role unchanged");
  const normalizedTwice = new MockDatabaseStore(storage).getSnapshot();
  assert.equal(normalizedTwice.roles.filter((role) => role.id === customerRoles[0].id).length, 1, "Normalization is idempotent");
  assert.equal(normalizedTwice.users.find((user) => user.id === registerResult.user.id)?.roleId, customerRoles[0].id, "Repaired relation persists");

  // SCENARIO 9: PRIVATE ROUTE AUTHORITY
  assert.equal(canUserEnterPrivateRoute(verifiedUser!, `/tienda/${tenantSlug}/cuenta`), true, "Customer route classification allows Customer path");
  assert.equal(canUserEnterPrivateRoute(verifiedUser!, `/administracion/usuarios`), false, "Employee-only routes must remain denied");

  // SCENARIO 9: GLOBAL CUSTOMER LOGIN
  const globalLoginResult = await auth.login({
    tenantId: undefined, // Global
    email: "lifecycle@example.com",
    passwordMock: "SecurePass123!"
  }).catch(e => e);
  assert.ok(globalLoginResult instanceof Error, "must NOT become an Employee/Admin SaaS session");

  // SCENARIO 10: EMPLOYEE REGRESSION
  const employeeResult = await auth.login({
    tenantId: undefined,
    email: "admin@ferrepharma.demo",
    passwordMock: "AdminDemo123"
  });
  assert.equal(employeeResult.status, "authenticated");
  const employeeUser = store.getSnapshot().users.find((u) => u.id === (employeeResult as { session: { userId: string } }).session.userId);
  const employeeDest = resolvePostLoginDestination(employeeUser!);
  assert.equal(employeeDest, "/inicio", "existing SaaS post-login destination still works");
  assert.equal(canUserEnterPrivateRoute(employeeUser!, "/cuenta"), false, "Employee must not access /cuenta");
  assert.equal(canUserEnterPrivateRoute(employeeUser!, "/cuenta/pedidos"), false, "Employee must not access /cuenta/pedidos");

  const { isCustomerAccountIdentity } = await import("@/modules/customer/components/CustomerAccountShell");
  assert.equal(isCustomerAccountIdentity(employeeUser!), false, "Employee must be blocked at Customer account boundary");
  assert.equal(isCustomerAccountIdentity(verifiedUser!), true, "Customer remains allowed at Customer account boundary");

  // SCENARIO 11: REQUIREPERMISSION ROUTE NORMALIZATION
  const { normalizeCustomerPermissionPathname } = await import("@/modules/auth/components/RequirePermission");

  // Account root
  assert.equal(normalizeCustomerPermissionPathname(`/tienda/mock-tenant/cuenta`), "/cuenta");
  assert.equal(normalizeCustomerPermissionPathname(`/tienda/mock-tenant/cuenta/`), "/cuenta");

  // Account sub-routes
  assert.equal(normalizeCustomerPermissionPathname(`/tienda/mock-tenant/cuenta/perfil`), "/cuenta/perfil");
  assert.equal(normalizeCustomerPermissionPathname(`/tienda/mock-tenant/cuenta/pedidos`), "/cuenta/pedidos");
  assert.equal(normalizeCustomerPermissionPathname(`/tienda/mock-tenant/cuenta/direcciones`), "/cuenta/direcciones");

  // Non-account storefront routes
  assert.equal(normalizeCustomerPermissionPathname(`/tienda/mock-tenant/catalogo`), `/tienda/mock-tenant/catalogo`);
  assert.equal(normalizeCustomerPermissionPathname(`/tienda/mock-tenant/carrito`), `/tienda/mock-tenant/carrito`);

  // Other routes
  assert.equal(normalizeCustomerPermissionPathname(`/cuenta/perfil`), `/cuenta/perfil`);
  assert.equal(normalizeCustomerPermissionPathname(`/inicio`), `/inicio`);

  console.log("Customer Auth Lifecycle: ALL PASS");
}

runLifecycleTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
