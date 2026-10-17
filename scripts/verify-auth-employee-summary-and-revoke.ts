import assert from "node:assert/strict";
import { AccountStatus, UserStatus, UserType } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockAuthRepository, MockUserRepository } from "@/infrastructure/mock/repositories";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";

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

const NOW = "2026-01-01T00:00:00.000Z";
const TENANT_A = "auth-summary-tenant-a";
const TENANT_B = "auth-summary-tenant-b";

function createHarness() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    db.users = [
      ...db.users,
      {
        id: "es-user-a1",
        tenantId: TENANT_A,
        name: "Empleado A1",
        email: "es-a1@example.test",
        type: UserType.employee,
        status: UserStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "es-user-a2-mfa",
        tenantId: TENANT_A,
        name: "Empleado A2",
        email: "es-a2@example.test",
        type: UserType.employee,
        status: UserStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "es-user-a3-no-account",
        tenantId: TENANT_A,
        name: "Empleado A3 sin cuenta",
        email: "es-a3@example.test",
        type: UserType.employee,
        status: UserStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "es-user-b1",
        tenantId: TENANT_B,
        name: "Empleado B1",
        email: "es-b1@example.test",
        type: UserType.employee,
        status: UserStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    db.authAccounts = [
      ...db.authAccounts,
      {
        id: "es-account-a1",
        userId: "es-user-a1",
        email: "es-a1@example.test",
        passwordHashMock: "hash",
        status: AccountStatus.active,
        failedLoginAttempts: 0,
        lastLoginAt: "2026-06-01T00:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "es-account-a2",
        userId: "es-user-a2-mfa",
        email: "es-a2@example.test",
        passwordHashMock: "hash",
        status: AccountStatus.temporarily_locked,
        failedLoginAttempts: 5,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "es-account-b1",
        userId: "es-user-b1",
        email: "es-b1@example.test",
        passwordHashMock: "hash",
        status: AccountStatus.active,
        failedLoginAttempts: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    db.mfaEnrollments = [
      ...db.mfaEnrollments,
      {
        id: "es-mfa-a2",
        userId: "es-user-a2-mfa",
        enabled: true,
        method: "totp",
        demoCodeMock: "000000",
        verifiedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    db.sessions = [
      ...db.sessions,
      {
        id: "es-session-a1-1",
        userId: "es-user-a1",
        createdAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        rememberMe: false,
      },
      {
        id: "es-session-a1-2",
        userId: "es-user-a1",
        createdAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        rememberMe: false,
      },
      {
        id: "es-session-b1-1",
        userId: "es-user-b1",
        createdAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        rememberMe: false,
      },
    ];
  });

  return {
    auth: new MockAuthRepository(store, eventBus, new MemoryStorageAdapter()),
    users: new MockUserRepository(store, eventBus),
    store,
  };
}

async function verifySummaries() {
  const { auth } = createHarness();

  // A. Auth summary same tenant -> PASS
  const sameTenant = await auth.getEmployeeAuthSummariesByUserIds(TENANT_A, [
    "es-user-a1",
    "es-user-a2-mfa",
  ]);
  assert.equal(sameTenant.length, 2, "Debe devolver ambos summaries del mismo tenant");

  // B. Auth summary cross tenant -> excluded
  const crossTenant = await auth.getEmployeeAuthSummariesByUserIds(TENANT_A, ["es-user-b1"]);
  assert.deepEqual(crossTenant, [], "Un userId de otro tenant no debe aparecer en el resultado");

  // C. batch con IDs duplicados -> coherente, sin duplicar filas
  const withDuplicates = await auth.getEmployeeAuthSummariesByUserIds(TENANT_A, [
    "es-user-a1",
    "es-user-a1",
    "es-user-a1",
  ]);
  assert.equal(withDuplicates.length, 1, "IDs duplicados deben deduplicarse");

  // D. sin AuthAccount -> ausente del resultado, sin error
  const noAccount = await auth.getEmployeeAuthSummariesByUserIds(TENANT_A, [
    "es-user-a3-no-account",
  ]);
  assert.deepEqual(noAccount, [], "Un User sin AuthAccount no debe aparecer, sin lanzar");

  // E. mfaEnabled preciso
  const a1 = sameTenant.find((item) => item.userId === "es-user-a1");
  const a2 = sameTenant.find((item) => item.userId === "es-user-a2-mfa");
  assert.equal(a1?.mfaEnabled, false, "es-user-a1 no tiene MFA habilitado");
  assert.equal(a2?.mfaEnabled, true, "es-user-a2-mfa sí tiene MFA habilitado");
  assert.equal(a2?.status, AccountStatus.temporarily_locked);

  // F. lastLoginAt preciso
  assert.equal(a1?.lastLoginAt, "2026-06-01T00:00:00.000Z");
  assert.equal(a2?.lastLoginAt, undefined, "Nunca inició sesión -> undefined, no null/fecha inventada");

  // G. sin datos secretos en el DTO
  const keys = Object.keys(a1 ?? {});
  for (const forbidden of [
    "passwordHashMock",
    "failedLoginAttempts",
    "lockedUntil",
    "recoveryCodes",
    "demoCodeMock",
    "invitationToken",
  ]) {
    assert.equal(keys.includes(forbidden), false, `EmployeeAuthSummary no debe incluir ${forbidden}`);
  }
}

async function verifyRevoke() {
  const { auth, store } = createHarness();

  // H. revoke current User -> todas revocadas
  await auth.revokeAllSessionsByUserId(TENANT_A, "es-user-a1");
  const dbAfter = store.getSnapshot();
  const a1Sessions = dbAfter.sessions.filter((item) => item.userId === "es-user-a1");
  assert.ok(a1Sessions.every((item) => Boolean(item.revokedAt)), "Todas las sesiones de A1 deben quedar revocadas");

  // I. retry -> idempotente, no lanza
  await auth.revokeAllSessionsByUserId(TENANT_A, "es-user-a1");

  // K. sesiones de otro usuario intactas
  const b1Sessions = store.getSnapshot().sessions.filter((item) => item.userId === "es-user-b1");
  assert.ok(b1Sessions.every((item) => !item.revokedAt), "Revocar A1 no debe tocar sesiones de B1");

  // J. cross-tenant -> denegado (no revoca nada)
  const beforeCrossAttempt = store.getSnapshot().sessions.find((item) => item.id === "es-session-b1-1");
  await auth.revokeAllSessionsByUserId(TENANT_A, "es-user-b1");
  const afterCrossAttempt = store.getSnapshot().sessions.find((item) => item.id === "es-session-b1-1");
  assert.equal(beforeCrossAttempt?.revokedAt, afterCrossAttempt?.revokedAt);
  assert.equal(afterCrossAttempt?.revokedAt, undefined, "Un tenant no debe poder revocar sesiones de otro");
}

async function main() {
  await verifySummaries();
  await verifyRevoke();
  console.log("auth employee summary + revoke sessions verification: PASS");
}

void main();
