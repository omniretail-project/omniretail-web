import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthRepository } from "@/core/repositories";
import {
  AccountStatus,
  BranchStatus,
  BranchType,
  PlanCode,
  PlanStatus,
  RoleStatus,
  SaasCapabilityKey,
  TenantSubscriptionStatus,
  UserStatus,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  MockAuditLogRepository,
  MockAuthRepository,
  MockBranchRepository,
  MockPlanRepository,
  MockRoleRepository,
  MockTenantSubscriptionRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import type { EmployeeInputDto } from "@/modules/administration/application/dto/EmployeeDto";
import { CreateEmployeeService } from "@/modules/administration/application/services/CreateEmployeeService";
import { ResendInvitationService } from "@/modules/administration/application/services/ResendInvitationService";

/**
 * Ticket "FIXES FOCALIZADOS" §1/§9: prueba específicamente el camino "users.create() PASS,
 * auth.inviteEmployee() FAIL" y su recuperación vía ResendInvitationService, más el gap
 * cross-tenant que inviteEmployee(userId) no cierra por sí mismo (ver comentario en
 * ResendInvitationService.ts). No duplica los escenarios ya cubiertos por verify-admin-users.ts
 * (alta feliz, validaciones de rol/sucursal, delegación de privilegios) ni por
 * verify-auth-employee-summary-and-revoke.ts (contrato de Auth en sí) -- se enfoca solo en el
 * ciclo fail -> stays fail-closed -> retry -> retry seguro -> protecciones.
 */

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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const NOW = "2026-01-01T00:00:00.000Z";

/**
 * feature/saas-entitlement-enforcement agregó un límite SaaS delante de CreateEmployeeService --
 * este harness prueba el ciclo de invitación/recuperación, no entitlements, así que cada tenant
 * fixture necesita un Plan "full" para no quedar bloqueado.
 */
function seedFullEntitlementPlan(db: MockDatabase, tenantId: string) {
  const planId = `plan-full-${tenantId}`;
  db.planDefinitions.push({
    id: planId,
    code: PlanCode.enterprise,
    name: `Plan full (fixture ${tenantId})`,
    status: PlanStatus.active,
    capabilities: Object.values(SaasCapabilityKey),
    limits: {},
    createdAt: NOW,
    updatedAt: NOW,
  });
  db.tenantSubscriptions.push({
    id: `tenant-subscription-${tenantId}`,
    tenantId,
    planId,
    status: TenantSubscriptionStatus.active,
    startedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
}
const TENANT_A = "invite-recovery-tenant-a";
const TENANT_B = "invite-recovery-tenant-b";
const ACTOR_ID = "invite-recovery-actor";
const MANAGE_PERMISSION = "admin.users.manage";
const ACTOR_PERMISSIONS = [MANAGE_PERMISSION];

/**
 * Envuelve el AuthRepository real (Mock) en un Proxy que puede fallar UNA sola vez en
 * inviteEmployee -- simula exactamente el escenario del ticket ("auth.inviteEmployee() FAIL")
 * sin tocar el contrato real ni inventar un mock paralelo: todo lo demás delega intacto al
 * MockAuthRepository de siempre.
 */
function withOneShotInviteFailure(auth: AuthRepository) {
  let shouldFailNext = false;
  const handler: ProxyHandler<AuthRepository> = {
    get(target, prop, receiver) {
      if (prop === "inviteEmployee") {
        return async (userId: string) => {
          if (shouldFailNext) {
            shouldFailNext = false;
            throw new Error("Fallo simulado de Auth (outage transitorio)");
          }
          return target.inviteEmployee(userId);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  };
  const proxy = new Proxy(auth, handler) as AuthRepository & {
    triggerNextInviteFailure: () => void;
  };
  return {
    auth: proxy,
    triggerNextInviteFailure: () => {
      shouldFailNext = true;
    },
  };
}

function createHarness() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    seedFullEntitlementPlan(db, TENANT_A);
    seedFullEntitlementPlan(db, TENANT_B);
    db.branches = [
      ...db.branches,
      {
        id: "ir-branch-a1",
        tenantId: TENANT_A,
        code: "IR-A1",
        name: "Sucursal A1",
        type: BranchType.store,
        status: BranchStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    db.roles = [
      ...db.roles,
      {
        id: "ir-role-ok",
        tenantId: TENANT_A,
        name: "Rol delegable",
        isSystem: false,
        permissions: [],
        branchScope: "assigned",
        status: RoleStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
  });

  const roles = new MockRoleRepository(store, eventBus);
  const branches = new MockBranchRepository(store, eventBus);
  const users = new MockUserRepository(store, eventBus);
  const realAuth = new MockAuthRepository(store, eventBus, new MemoryStorageAdapter());
  const auditLogs = new MockAuditLogRepository(store, eventBus);
  const plans = new MockPlanRepository(store, eventBus);
  const tenantSubscriptions = new MockTenantSubscriptionRepository(store, eventBus);
  const { auth, triggerNextInviteFailure } = withOneShotInviteFailure(realAuth);

  return {
    repositories: {
      roles,
      branches,
      users,
      auth,
      auditLogs,
      plans,
      tenantSubscriptions,
    } as unknown as RepositoryRegistry,
    store,
    triggerNextInviteFailure,
  };
}

function baseInput(overrides: Partial<EmployeeInputDto> = {}): EmployeeInputDto {
  return {
    name: "Empleado Recovery",
    email: `ir-new-${Math.random().toString(36).slice(2)}@example.test`,
    phone: undefined,
    employeeCode: `IR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    roleId: "ir-role-ok",
    allowedBranchIds: ["ir-branch-a1"],
    status: UserStatus.active,
    ...overrides,
  };
}

async function main() {
  const harness = createHarness();
  const createService = new CreateEmployeeService(harness.repositories);
  const resendService = new ResendInvitationService(harness.repositories);
  const email = `ir-flaky-${Math.random().toString(36).slice(2)}@example.test`;

  // 1. first invite failure: users.create() PASS, auth.inviteEmployee() FAIL.
  harness.triggerNextInviteFailure();
  await assert.rejects(
    () => createService.execute(TENANT_A, baseInput({ email }), ACTOR_PERMISSIONS, ACTOR_ID),
    /no se pudo enviar la invitaci/i,
    "CreateEmployeeService debe reportar el fallo de invitación de forma legible",
  );

  // 2. User remains fail-closed: el User existe (no hay rollback destructivo) pero sin
  // AuthAccount todavía -- en la tabla aparecería "Sin cuenta".
  const created = await harness.repositories.users.getByEmail(email);
  assert.ok(created, "El User debe seguir existiendo aunque la invitación haya fallado");
  const accountAfterFailure = harness.store
    .getSnapshot()
    .authAccounts.find((account) => account.userId === created!.id);
  assert.equal(
    accountAfterFailure,
    undefined,
    "Sin AuthAccount todavía: el empleado queda fail-closed ('Sin cuenta')",
  );

  // 3. retry succeeds: ResendInvitationService reintenta con éxito (el proxy ya no falla).
  const afterRetry = await resendService.execute(
    TENANT_A,
    created!.id,
    ACTOR_PERMISSIONS,
    ACTOR_ID,
  );
  assert.equal(
    afterRetry.employee.authStatus,
    AccountStatus.password_reset_required,
    "Tras el reintento exitoso, el empleado pasa a password_reset_required (invitación pendiente)",
  );

  // Sugerencia de scrum "copiar invitación": el token debe viajar en el resultado de ESTA acción
  // puntual, y jamás colgado de EmployeeDto (ese nunca debe volver a exponer tokens -- ver
  // EmployeeDto.ts). Así la UI puede ofrecer "copiar invitación" sin que el token quede accesible
  // desde ningún otro lado (listado, localStorage, etc.).
  assert.equal(typeof afterRetry.invitationToken, "string");
  assert.ok((afterRetry.invitationToken as string).length > 0);
  assert.equal(
    Object.prototype.hasOwnProperty.call(afterRetry.employee, "invitationToken"),
    false,
    "EmployeeDto no debe cargar invitationToken -- viaja solo en el resultado de la acción puntual",
  );

  // 4. account/invitation created once: exactamente 1 AuthAccount y 1 EmployeeInvitation para
  // este userId -- el reintento no duplica nada.
  const snapshotAfterRetry = harness.store.getSnapshot();
  const accountsForUser = snapshotAfterRetry.authAccounts.filter(
    (account) => account.userId === created!.id,
  );
  const invitationsAfterRetry = snapshotAfterRetry.employeeInvitations.filter(
    (invitation) => invitation.userId === created!.id,
  );
  assert.equal(accountsForUser.length, 1, "Debe existir exactamente 1 AuthAccount, nunca 2");
  assert.equal(
    invitationsAfterRetry.length,
    1,
    "El primer reintento exitoso genera exactamente 1 EmployeeInvitation",
  );
  const accountIdAfterFirstRetry = accountsForUser[0]!.id;

  // 5. repeated retry safe: reintentar de nuevo (invitación previa todavía vigente, "existe
  // invitación vigente" del ticket) no falla, no duplica el AuthAccount, y emite una invitación
  // nueva (la anterior queda huérfana pero válida hasta su propio vencimiento, según contrato de
  // inviteEmployee).
  await resendService.execute(TENANT_A, created!.id, ACTOR_PERMISSIONS, ACTOR_ID);
  const snapshotAfterSecondRetry = harness.store.getSnapshot();
  const accountsAfterSecondRetry = snapshotAfterSecondRetry.authAccounts.filter(
    (account) => account.userId === created!.id,
  );
  const invitationsAfterSecondRetry = snapshotAfterSecondRetry.employeeInvitations.filter(
    (invitation) => invitation.userId === created!.id,
  );
  assert.equal(
    accountsAfterSecondRetry.length,
    1,
    "Un segundo reintento NO debe crear un segundo AuthAccount",
  );
  assert.equal(
    accountsAfterSecondRetry[0]!.id,
    accountIdAfterFirstRetry,
    "El segundo reintento debe reutilizar el MISMO AuthAccount, nunca uno nuevo",
  );
  assert.equal(
    invitationsAfterSecondRetry.length,
    2,
    "Cada reintento emite su propia EmployeeInvitation (la anterior queda huérfana, no se borra)",
  );

  // 6. active account cannot be accidentally reinvited/reset: una vez activada la cuenta,
  // ResendInvitationService debe rechazar el reintento y no tocar el AuthAccount para nada.
  harness.store.mutate((db) => {
    const account = db.authAccounts.find((item) => item.userId === created!.id);
    if (account) account.status = AccountStatus.active;
  });
  await assert.rejects(
    () => resendService.execute(TENANT_A, created!.id, ACTOR_PERMISSIONS, ACTOR_ID),
    /ya tiene una cuenta activa/i,
    "Una cuenta ya activa no debe poder reinvitarse",
  );
  const snapshotAfterActiveAttempt = harness.store.getSnapshot();
  assert.equal(
    snapshotAfterActiveAttempt.authAccounts.filter((account) => account.userId === created!.id)
      .length,
    1,
    "El intento rechazado no debe crear ni duplicar AuthAccounts",
  );
  assert.equal(
    snapshotAfterActiveAttempt.employeeInvitations.filter(
      (invitation) => invitation.userId === created!.id,
    ).length,
    2,
    "El intento rechazado no debe emitir una nueva EmployeeInvitation",
  );

  // 7. cross tenant denied: un actor de TENANT_B no puede reinvitar a un empleado de TENANT_A,
  // ni siquiera conociendo su id -- cierra el gap de inviteEmployee(userId), que no valida tenant
  // por sí mismo (ver comentario en ResendInvitationService.ts). Mismo mensaje que cualquier otro
  // id ajeno/inexistente -- no se distingue el motivo (no-oráculo).
  await assert.rejects(
    () => resendService.execute(TENANT_B, created!.id, ACTOR_PERMISSIONS, ACTOR_ID),
    /no está disponible para el negocio activo/i,
    "Un actor de otro tenant no debe poder reinvitar a un empleado que no le pertenece",
  );
  const snapshotAfterCrossTenant = harness.store.getSnapshot();
  assert.equal(
    snapshotAfterCrossTenant.authAccounts.find((account) => account.userId === created!.id)
      ?.status,
    AccountStatus.active,
    "El intento cross-tenant no debe alterar el estado de la cuenta real",
  );
  assert.equal(
    snapshotAfterCrossTenant.employeeInvitations.filter(
      (invitation) => invitation.userId === created!.id,
    ).length,
    2,
    "El intento cross-tenant no debe emitir ninguna EmployeeInvitation",
  );

  // 8. permiso del actor: sin admin.users.manage, ResendInvitationService rechaza antes de
  // resolver nada (mismo orden que CreateEmployeeService/UpdateEmployeeService).
  await assert.rejects(
    () => resendService.execute(TENANT_A, created!.id, [], ACTOR_ID),
    /no tenés permiso/i,
    "Sin admin.users.manage no se puede reintentar ninguna invitación",
  );

  // 9. invariante de código: ResendInvitationService nunca escribe directo sobre
  // authAccounts/employeeInvitations -- siempre a través de AuthRepository.inviteEmployee.
  const source = stripComments(
    readFileSync(
      join(
        process.cwd(),
        "src/modules/administration/application/services/ResendInvitationService.ts",
      ),
      "utf8",
    ),
  );
  assert.equal(
    /authAccounts\s*\.\s*push|db\.authAccounts|employeeInvitations\s*\.\s*push|db\.employeeInvitations/.test(
      source,
    ),
    false,
    "ResendInvitationService no debe escribir AuthAccount/EmployeeInvitation directamente",
  );
  assert.ok(
    /inviteEmployee/.test(source),
    "ResendInvitationService debe reutilizar AuthRepository.inviteEmployee",
  );
  assert.ok(
    /getByIdScoped/.test(source),
    "ResendInvitationService debe resolver el empleado tenant-scoped ANTES de invocar Auth (gap cross-tenant)",
  );

  console.log("invitation recovery verification: PASS");
}

void main();
