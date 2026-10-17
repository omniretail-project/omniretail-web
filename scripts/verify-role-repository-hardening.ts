import assert from "node:assert/strict";
import type { RoleRepository } from "@/core/repositories";
import { AccountStatus, RoleStatus, UserStatus, UserType } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockAuthRepository,
  MockRoleRepository,
  MockTenantRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import { buildPasswordHashMock } from "@/infrastructure/mock/shared/passwordHashMock";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { MOCK_DATABASE_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";

const TENANT_A = "tenant-demo";
const TENANT_B = "tenant-role-hardening-b";
const NOW = "2026-09-14T12:00:00.000Z";

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

function createRoleHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const repository = new MockRoleRepository(store, eventBus);
  const roleA = store.getSnapshot().roles.find((role) => role.tenantId === TENANT_A);
  assert.ok(roleA);
  const roleB = {
    ...roleA,
    id: "role-hardening-b",
    tenantId: TENANT_B,
    name: "Role B",
    isSystem: false,
  };
  store.mutate((db) => {
    db.roles.push(roleB);
  });
  return { eventBus, repository, roleA, roleB, store };
}

async function verifyTenantScopedRepository() {
  const { eventBus, repository, roleA, roleB, store } = createRoleHarness();
  const events: Array<{ entityId?: string; tenantId?: string; action?: string }> = [];
  eventBus.subscribe("role.changed", (event) => events.push(event));

  const rolesA = await repository.listByTenant(TENANT_A);
  assert.ok(rolesA.length > 0);
  assert.ok(
    rolesA.every((role) => role.tenantId === TENANT_A),
    "A: list filtra por tenant",
  );
  assert.equal(await repository.getByIdScoped(TENANT_A, roleB.id), null, "B: read cross-tenant");
  assert.equal(events.length, 0, "K: los reads no emiten role.changed");

  await assert.rejects(
    repository.updateScoped(TENANT_A, roleB.id, { name: "Intrusion" }),
    /not found|denied/i,
  );
  await assert.rejects(repository.archiveScoped(TENANT_A, roleB.id), /not found|denied/i);
  assert.deepEqual(
    store.getSnapshot().roles.find((role) => role.id === roleB.id),
    roleB,
    "C/D: una mutacion cross-tenant no cambia Role B",
  );
  assert.equal(events.length, 0, "K: una mutacion rechazada no emite role.changed");

  type UpdateInput = Parameters<RoleRepository["updateScoped"]>[2];
  type ForbiddenUpdateKeys = Extract<
    keyof UpdateInput,
    "id" | "tenantId" | "isSystem" | "createdAt" | "updatedAt"
  >;
  const updateContractRejectsForbiddenKeys: ForbiddenUpdateKeys extends never ? true : false = true;
  assert.equal(updateContractRejectsForbiddenKeys, true);

  const maliciousUpdatedAt = "2000-01-01T00:00:00.000Z";
  const maliciousInput = {
    id: "replacement-id",
    tenantId: TENANT_B,
    isSystem: !roleA.isSystem,
    createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: maliciousUpdatedAt,
    name: "Role A updated",
  } as unknown as UpdateInput;
  const updated = await repository.updateScoped(TENANT_A, roleA.id, maliciousInput);
  assert.equal(updated.id, roleA.id);
  assert.equal(updated.tenantId, TENANT_A);
  assert.equal(updated.isSystem, roleA.isSystem);
  assert.equal(updated.createdAt, roleA.createdAt);
  assert.notEqual(updated.updatedAt, maliciousUpdatedAt);
  assert.equal(updated.name, "Role A updated");
  assert.equal(events.length, 1, "K: update valido emite una vez");

  const archived = await repository.archiveScoped(TENANT_A, roleA.id);
  assert.equal(archived.status, RoleStatus.archived);
  assert.equal(events.length, 2, "K: archive valido emite una vez");

  const created = await repository.create({
    tenantId: TENANT_A,
    name: "Custom role",
    isSystem: false,
    permissions: ["catalog.products.read"],
    branchScope: "selected",
    status: RoleStatus.active,
  });
  assert.equal(created.tenantId, TENANT_A, "CREATE: tenantId se conserva");
  assert.equal(events.length, 3, "K: create valido emite una vez");
}

function createSessionHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const snapshot = store.getSnapshot();
  const activeRole = snapshot.roles.find((role) => role.id === "role-admin");
  const activeEmployee = snapshot.users.find((user) => user.id === "user-admin");
  const adminAccount = snapshot.authAccounts.find((account) => account.userId === "user-admin");
  assert.ok(activeRole && activeEmployee && adminAccount);

  const inactiveRole = {
    ...activeRole,
    id: "role-hardening-inactive",
    isSystem: false,
    status: RoleStatus.inactive,
  };
  const archivedRole = {
    ...activeRole,
    id: "role-hardening-archived",
    isSystem: false,
    status: RoleStatus.archived,
  };
  const inactiveEmployee = {
    ...activeEmployee,
    id: "user-role-hardening-inactive",
    email: "inactive-role@hardening.test",
    roleId: inactiveRole.id,
  };
  const archivedEmployee = {
    ...activeEmployee,
    id: "user-role-hardening-archived",
    email: "archived-role@hardening.test",
    roleId: archivedRole.id,
  };
  const customerWithoutRole = {
    ...activeEmployee,
    id: "user-role-hardening-customer",
    email: "customer-no-role@hardening.test",
    type: UserType.customer,
    roleId: undefined,
    branchId: undefined,
    allowedBranchIds: undefined,
    status: UserStatus.active,
  };
  store.mutate((db) => {
    db.roles.push(inactiveRole, archivedRole);
    db.users.push(inactiveEmployee, archivedEmployee, customerWithoutRole);
    db.authAccounts.push(
      {
        ...adminAccount,
        id: "auth-role-hardening-inactive",
        userId: inactiveEmployee.id,
        email: inactiveEmployee.email,
        status: AccountStatus.active,
        passwordHashMock: buildPasswordHashMock("RoleHardening123"),
      },
      {
        ...adminAccount,
        id: "auth-role-hardening-archived",
        userId: archivedEmployee.id,
        email: archivedEmployee.email,
        status: AccountStatus.active,
        passwordHashMock: buildPasswordHashMock("RoleHardening123"),
      },
      {
        ...adminAccount,
        id: "auth-role-hardening-customer",
        userId: customerWithoutRole.id,
        email: customerWithoutRole.email,
        status: AccountStatus.active,
        passwordHashMock: buildPasswordHashMock("RoleHardening123"),
      },
    );
  });

  let currentUserId = activeEmployee.id;
  const session = {
    id: "role-hardening-session",
    createdAt: NOW,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    rememberMe: false,
  };
  const repositories = {
    auth: {
      getCurrentSessionId: async () => session.id,
      getSession: async (sessionId: string) =>
        sessionId === session.id ? { ...session, userId: currentUserId } : null,
    },
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return {
    activeEmployee,
    activeRole,
    archivedEmployee,
    customerWithoutRole,
    eventBus,
    inactiveEmployee,
    repositories,
    setCurrentUser(userId: string) {
      currentUserId = userId;
    },
    storage,
    store,
  };
}

async function verifyRoleStatusAndAuth() {
  const harness = createSessionHarness();
  assert.equal(
    (await resolveCurrentSessionSnapshot(harness.repositories)).user?.id,
    harness.activeEmployee.id,
    "H: Role active permite sesion",
  );
  harness.setCurrentUser(harness.inactiveEmployee.id);
  assert.equal(
    (await resolveCurrentSessionSnapshot(harness.repositories)).user,
    null,
    "F: Role inactive deniega sesion",
  );
  harness.setCurrentUser(harness.archivedEmployee.id);
  assert.equal(
    (await resolveCurrentSessionSnapshot(harness.repositories)).user,
    null,
    "G: Role archived deniega sesion",
  );
  harness.setCurrentUser(harness.customerWithoutRole.id);
  assert.equal(
    (await resolveCurrentSessionSnapshot(harness.repositories)).user?.id,
    harness.customerWithoutRole.id,
    "I: Customer sin Role no se rompe",
  );

  const auth = new MockAuthRepository(harness.store, harness.eventBus, harness.storage);
  await assert.rejects(
    auth.login({
      email: harness.inactiveEmployee.email,
      passwordMock: "RoleHardening123",
      expectedUserType: UserType.employee,
    }),
  );
  await assert.rejects(
    auth.login({
      email: harness.archivedEmployee.email,
      passwordMock: "RoleHardening123",
      expectedUserType: UserType.employee,
    }),
  );
  const customerLogin = await auth.login({
    tenantId: TENANT_A,
    email: harness.customerWithoutRole.email,
    passwordMock: "RoleHardening123",
    expectedUserType: UserType.customer,
  });
  assert.equal(customerLogin.status, "authenticated", "I: Auth Customer sin Role conserva login");

  harness.store.mutate((db) => {
    db.mfaEnrollments.push({
      id: "mfa-role-hardening",
      userId: harness.activeEmployee.id,
      enabled: true,
      method: "totp",
      demoCodeMock: "654321",
      verifiedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  const mfaLogin = await auth.login({
    email: harness.activeEmployee.email,
    passwordMock: "AdminDemo123",
    expectedUserType: UserType.employee,
  });
  assert.equal(mfaLogin.status, "mfa_required", "I: MFA active conserva challenge");
  assert.equal(
    (
      await auth.verifyMfaChallenge(
        (mfaLogin as Extract<typeof mfaLogin, { status: "mfa_required" }>).challengeId,
        "654321",
      )
    ).userId,
    harness.activeEmployee.id,
    "I: MFA active conserva autenticacion",
  );

  const pendingMfaLogin = await auth.login({
    email: harness.activeEmployee.email,
    passwordMock: "AdminDemo123",
    expectedUserType: UserType.employee,
  });
  assert.equal(pendingMfaLogin.status, "mfa_required");
  const sessionsBeforeRoleChange = harness.store
    .getSnapshot()
    .sessions.filter((session) => session.userId === harness.activeEmployee.id).length;

  harness.setCurrentUser(harness.activeEmployee.id);
  const revalidated = new Promise<Awaited<ReturnType<typeof resolveCurrentSessionSnapshot>>>(
    (resolve) => {
      const unsubscribe = harness.eventBus.subscribe("role.changed", async () => {
        unsubscribe();
        resolve(await resolveCurrentSessionSnapshot(harness.repositories));
      });
    },
  );
  await harness.repositories.roles.updateScoped(TENANT_A, harness.activeRole.id, {
    status: RoleStatus.inactive,
  });
  assert.equal((await revalidated).user, null, "K: role.changed dispara revalidacion fail-closed");
  await assert.rejects(
    auth.verifyMfaChallenge(
      (pendingMfaLogin as Extract<typeof pendingMfaLogin, { status: "mfa_required" }>).challengeId,
      "654321",
    ),
    /válido|venció|vencio/i,
    "I: MFA no completa una sesion si el Role se inactiva durante el challenge",
  );
  assert.equal(
    harness.store
      .getSnapshot()
      .sessions.filter((session) => session.userId === harness.activeEmployee.id).length,
    sessionsBeforeRoleChange,
    "I: MFA rechazado por Role inactive no crea Session",
  );
}

function verifyLegacyBackfill() {
  const sourceStorage = new MemoryStorageAdapter();
  const source = new MockDatabaseStore(sourceStorage).getSnapshot();
  const missingStatus = source.roles[0];
  const preservedStatus = source.roles[1];
  assert.ok(missingStatus && preservedStatus);
  const expectedLegacyFields = {
    id: missingStatus.id,
    tenantId: missingStatus.tenantId,
    permissions: missingStatus.permissions,
    branchScope: missingStatus.branchScope,
    isSystem: missingStatus.isSystem,
  };
  const persisted = structuredClone(source) as unknown as {
    roles: Array<Record<string, unknown>>;
  };
  delete persisted.roles[0].status;
  persisted.roles[1].status = RoleStatus.archived;
  const storage = new MemoryStorageAdapter();
  storage.set(MOCK_DATABASE_STORAGE_KEY, persisted);

  const reloaded = new MockDatabaseStore(storage).getSnapshot();
  const reloadedLegacy = reloaded.roles.find((role) => role.id === missingStatus.id);
  const reloadedArchived = reloaded.roles.find((role) => role.id === preservedStatus.id);
  assert.ok(reloadedLegacy && reloadedArchived);
  assert.equal(
    reloadedLegacy.status,
    RoleStatus.active,
    "J: legacy sin status hace backfill active",
  );
  assert.equal(
    reloadedArchived.status,
    RoleStatus.archived,
    "LEGACY: status existente se preserva",
  );
  assert.deepEqual(
    {
      id: reloadedLegacy.id,
      tenantId: reloadedLegacy.tenantId,
      permissions: reloadedLegacy.permissions,
      branchScope: reloadedLegacy.branchScope,
      isSystem: reloadedLegacy.isSystem,
    },
    expectedLegacyFields,
    "LEGACY: IDs, tenant, permissions, branchScope e isSystem se preservan",
  );
}

async function main() {
  await verifyTenantScopedRepository();
  console.log("role repository tenant scope and events: PASS");
  await verifyRoleStatusAndAuth();
  console.log("role status, session, Customer/Auth/MFA and revalidation: PASS");
  verifyLegacyBackfill();
  console.log("legacy Role backfill and preservation: PASS");
}

void main();
