/**
 * Verificación focalizada de las políticas Customer/Employee y de sus boundaries reales.
 *
 * Uso:
 *   npx tsx scripts/verify-password-policy.ts
 */
import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import {
  CUSTOMER_PASSWORD_POLICY,
  EMPLOYEE_PASSWORD_POLICY,
  PasswordPolicyError,
  validateCustomerPassword,
  validateEmployeePassword,
} from "@/config/auth-policy";
import { AccountStatus, UserStatus, UserType } from "@/core/enums";
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
import { CreatePublicContractService } from "@/modules/contracting/application/services/CreatePublicContractService";

const CUSTOMER_VALID_8 = "Abcd1!xy";
const EMPLOYEE_VALID_12 = "Abcdefgh1!xy";
const EMPLOYEE_VALID_LONG = "Marjym2026!Segura";

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

function createHarness() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();
  const sessionStorage = new MemoryStorageAdapter();
  const auth = new MockAuthRepository(store, eventBus, sessionStorage);
  const repositories = {
    tenants: new MockTenantRepository(store, eventBus),
    tenantOnboarding: new MockTenantOnboardingRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    auth,
    users: new MockUserRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    branches: new MockBranchRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    auditLogs: new MockAuditLogRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
  return { store, auth, repositories };
}

function assertAllowed(result: string | null, label: string) {
  assert.equal(result, null, `${label} debe permitirse`);
}

function assertDenied(result: string | null, label: string) {
  assert.equal(typeof result, "string", `${label} debe denegarse`);
  assert.ok(result, `${label} debe devolver un mensaje público`);
}

async function expectPolicyError(promise: Promise<unknown>, label: string) {
  await assert.rejects(promise, PasswordPolicyError, label);
}

function verifyPolicyMatrix() {
  assert.equal(CUSTOMER_PASSWORD_POLICY.MIN_LENGTH, 8);
  assert.equal(CUSTOMER_PASSWORD_POLICY.MAX_LENGTH, 24);
  assert.equal(EMPLOYEE_PASSWORD_POLICY.MIN_LENGTH, 12);
  assert.equal(EMPLOYEE_PASSWORD_POLICY.MAX_LENGTH, 24);

  assertAllowed(validateCustomerPassword(CUSTOMER_VALID_8), "Customer exactos 8");
  assertDenied(validateCustomerPassword("Ab1!xyz"), "Customer debajo del mínimo");
  assertDenied(validateCustomerPassword(`Aa1!${"x".repeat(21)}`), "Customer 25 caracteres");
  assertDenied(validateCustomerPassword("abcdef1!"), "Customer sin mayúscula");
  assertDenied(validateCustomerPassword("ABCDEF1!"), "Customer sin minúscula");
  assertDenied(validateCustomerPassword("Abcdefg!"), "Customer sin número");
  assertDenied(validateCustomerPassword("Abcdefg1"), "Customer sin especial");
  assertDenied(validateCustomerPassword("Password1!"), "Customer password común");
  assertDenied(validateCustomerPassword("12345678M"), "Customer 12345678M");
  assertDenied(validateCustomerPassword("12345678m"), "Customer 12345678m");
  assertAllowed(validateCustomerPassword("Abcdef1!"), "Customer Abcdef1!");
  assertDenied(
    validateCustomerPassword("melbyn@gmail.com", "MELBYN@GMAIL.COM"),
    "Customer password igual al email",
  );

  assert.equal(EMPLOYEE_VALID_12.length, 12);
  assertAllowed(validateEmployeePassword(EMPLOYEE_VALID_12), "Employee exactos 12");
  assertDenied(validateEmployeePassword("Abcdefg1!xy"), "Employee 11 caracteres");
  assertDenied(validateEmployeePassword(`Aa1!${"x".repeat(21)}`), "Employee 25 caracteres");
  assertDenied(validateEmployeePassword("abcdefghij1!"), "Employee sin mayúscula");
  assertDenied(validateEmployeePassword("ABCDEFGHIJ1!"), "Employee sin minúscula");
  assertDenied(validateEmployeePassword("AbcdefghijK!"), "Employee sin número");
  assertDenied(validateEmployeePassword("AbcdefghijK1"), "Employee sin especial");
  assertDenied(validateEmployeePassword("Password123!"), "Employee password común");
  assertDenied(validateEmployeePassword("Abcdef1!"), "Employee Abcdef1!");
  assertDenied(validateEmployeePassword("Marjym2026!"), "Employee Marjym2026! tiene 11");
  assertAllowed(validateEmployeePassword(EMPLOYEE_VALID_LONG), "Employee Marjym2026!Segura");
  assertDenied(
    validateEmployeePassword("melbyn@gmail.com", "MELBYN@GMAIL.COM"),
    "Employee password igual al email",
  );

  // No se introducen reglas de substring: sólo igualdad normalizada con el email.
  assertAllowed(
    validateEmployeePassword("Melbyn#Seguro2026", "melbyn@gmail.com"),
    "Employee puede incluir la parte local del email",
  );
}

async function verifyCustomerRegistration() {
  const { auth, store } = createHarness();
  const before = store.getSnapshot();
  await expectPolicyError(
    auth.registerCustomer({
      tenantSlug: publicStorefrontSlug,
      name: "Cliente débil",
      email: "weak-customer@example.test",
      passwordMock: "Abcdefg1",
    }),
    "registro Customer débil",
  );
  const afterWeak = store.getSnapshot();
  assert.equal(afterWeak.users.length, before.users.length);
  assert.equal(afterWeak.authAccounts.length, before.authAccounts.length);

  const result = await auth.registerCustomer({
    tenantSlug: publicStorefrontSlug,
    name: "Cliente seguro",
    email: "strong-customer@example.test",
    passwordMock: CUSTOMER_VALID_8,
  });
  assert.equal(result.user.type, UserType.customer);
}

async function verifyContractingAndNoPartialTenant() {
  const { repositories, store } = createHarness();
  const service = new CreatePublicContractService(repositories);
  const before = store.getSnapshot();

  await assert.rejects(
    service.execute({
      businessName: "Contrato débil",
      adminName: "Admin Débil",
      adminEmail: "weak-admin@example.test",
      adminPassword: "Marjym2026!",
    }),
    /entre 12 y 24/,
  );
  await assert.rejects(
    service.execute({
      businessName: "Contrato email",
      adminName: "Admin Email",
      adminEmail: "Admin1!@Example.com",
      adminPassword: "admin1!@example.com",
    }),
    /igual al correo electrónico/,
  );

  const afterRejected = store.getSnapshot();
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
    assert.equal(afterRejected[key].length, before[key].length, `${key} no debe cambiar`);
  }

  const created = await service.execute({
    businessName: "Contrato Seguro",
    adminName: "Admin Seguro",
    adminEmail: "strong-admin@example.test",
    adminPassword: EMPLOYEE_VALID_12,
  });
  assert.ok(await repositories.tenants.getById(created.tenantId));
}

async function verifyEmployeeActivation() {
  const { auth, repositories, store } = createHarness();
  const employee = await repositories.users.create({
    tenantId: "tenant-demo",
    name: "Empleado Policy",
    email: "employee-policy@example.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "role-admin",
    branchId: "branch-centro",
    allowedBranchIds: ["branch-centro"],
  });
  const invitation = await auth.inviteEmployee(employee.id);
  assert.ok(invitation.invitationToken);

  await expectPolicyError(
    auth.activateEmployeeAccount(invitation.invitationToken!, "Abcdef1!"),
    "activación Employee menor de 12",
  );
  const beforeSuccess = store
    .getSnapshot()
    .authAccounts.find((account) => account.userId === employee.id);
  assert.equal(beforeSuccess?.status, AccountStatus.password_reset_required);

  await auth.activateEmployeeAccount(invitation.invitationToken!, EMPLOYEE_VALID_12);
  const activated = store
    .getSnapshot()
    .authAccounts.find((account) => account.userId === employee.id);
  assert.equal(activated?.status, AccountStatus.active);
}

function latestResetToken(store: MockDatabaseStore, userId: string): string {
  const challenge = store
    .getSnapshot()
    .passwordResetChallenges.filter((item) => item.userId === userId)
    .at(-1);
  assert.ok(challenge, `debe existir challenge para ${userId}`);
  return challenge.token;
}

async function verifyResetPolicies() {
  const customerHarness = createHarness();
  await customerHarness.auth.requestPasswordReset({
    tenantId: "tenant-demo",
    email: "ana@example.com",
  });
  const customerToken = latestResetToken(customerHarness.store, "user-customer");
  await expectPolicyError(
    customerHarness.auth.resetPassword(customerToken, "Abcdefg1"),
    "reset Customer sin especial",
  );
  await customerHarness.auth.resetPassword(customerToken, CUSTOMER_VALID_8);

  const employeeHarness = createHarness();
  await employeeHarness.auth.requestPasswordReset({ email: "admin@ferrepharma.demo" });
  const employeeToken = latestResetToken(employeeHarness.store, "user-admin");
  await expectPolicyError(
    employeeHarness.auth.resetPassword(employeeToken, "Abcdef1!"),
    "reset Employee menor de 12",
  );
  await employeeHarness.auth.resetPassword(employeeToken, EMPLOYEE_VALID_12);
}

async function authenticatedSessionId(
  auth: MockAuthRepository,
  email: string,
  passwordMock: string,
  type: UserType,
): Promise<string> {
  const result = await auth.login({
    tenantId: "tenant-demo",
    email,
    passwordMock,
    expectedUserType: type,
  });
  assert.equal(result.status, "authenticated");
  if (result.status !== "authenticated") throw new Error("MFA inesperado en fixture");
  return result.session.id;
}

async function verifyChangePolicies() {
  const customerHarness = createHarness();
  const customerSession = await authenticatedSessionId(
    customerHarness.auth,
    "ana@example.com",
    "ClienteDemo1",
    UserType.customer,
  );
  await expectPolicyError(
    customerHarness.auth.changePassword({
      sessionId: customerSession,
      currentPasswordMock: "ClienteDemo1",
      newPasswordMock: "Abcdefg1",
    }),
    "change Customer sin especial",
  );
  await customerHarness.auth.changePassword({
    sessionId: customerSession,
    currentPasswordMock: "ClienteDemo1",
    newPasswordMock: CUSTOMER_VALID_8,
  });

  const employeeHarness = createHarness();
  const employeeSession = await authenticatedSessionId(
    employeeHarness.auth,
    "admin@ferrepharma.demo",
    "AdminDemo123",
    UserType.employee,
  );
  await expectPolicyError(
    employeeHarness.auth.changePassword({
      sessionId: employeeSession,
      currentPasswordMock: "AdminDemo123",
      newPasswordMock: "Marjym2026!",
    }),
    "change Employee menor de 12",
  );
  await employeeHarness.auth.changePassword({
    sessionId: employeeSession,
    currentPasswordMock: "AdminDemo123",
    newPasswordMock: EMPLOYEE_VALID_12,
  });
}

async function verifyLegacyLoginDoesNotRevalidatePolicy() {
  const { auth } = createHarness();
  assertDenied(
    validateEmployeePassword("AdminDemo123", "admin@ferrepharma.demo"),
    "credential legacy bajo la política nueva",
  );
  const result = await auth.login({
    email: "admin@ferrepharma.demo",
    passwordMock: "AdminDemo123",
    expectedUserType: UserType.employee,
  });
  assert.equal(result.status, "authenticated", "login legacy debe continuar funcionando");
}

async function main() {
  verifyPolicyMatrix();
  await verifyCustomerRegistration();
  await verifyContractingAndNoPartialTenant();
  await verifyEmployeeActivation();
  await verifyResetPolicies();
  await verifyChangePolicies();
  await verifyLegacyLoginDoesNotRevalidatePolicy();

  console.log("PASS password matrix Customer/Employee y password != email");
  console.log("PASS registration, activation, reset, change y contracting sin residuos");
  console.log("PASS legacy login sin revalidación de la nueva política");
}

void main();
