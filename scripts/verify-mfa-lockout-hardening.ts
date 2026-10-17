/**
 * Harness de regresion para el hardening post-auditoria de PR #81
 * (MFA lockout).
 *
 * Cubre los 3 blockers reportados por la auditoria independiente:
 *   1. verifyMfaChallenge() ignoraba account.status -- un codigo MFA
 *      correcto podia completar el login con la cuenta ya bloqueada.
 *   2. El mismo hueco aplicaba a un recovery code valido (comparten el
 *      mismo flujo/metodo interno, consumeMfaCode()).
 *   3. El reset de exito en verifyMfaChallenge() limpiaba lockedUntil sin
 *      restaurar status=active, pudiendo dejar una cuenta bloqueada de
 *      forma indefinida.
 *
 * Tambien reproduce el exploit original que motivo PR #81 (reiniciar
 * login() no debe regalar una ventana nueva de intentos MFA) para
 * confirmar que el fix nuevo no lo reabre.
 *
 * Uso (desde la raiz del proyecto):
 *   npx tsx scripts/verify-mfa-lockout-hardening.ts
 *
 * No es parte del PR como tal (no hay npm script dedicado todavia): se
 * commitea junto al fix como evidencia reproducible, siguiendo el mismo
 * criterio que scripts/verify-*.ts existentes.
 */

import { MockDatabaseStore } from "../src/infrastructure/mock/database/MockDatabaseStore";
import { DataEventBus } from "../src/infrastructure/events/DataEventBus";
import { MockAuthRepository } from "../src/infrastructure/mock/repositories/MockAuthRepository";
import { LocalStorageAdapter } from "../src/infrastructure/storage/LocalStorageAdapter";
import { AccountStatus, UserStatus, UserType } from "../src/core/enums";
import { buildPasswordHashMock } from "../src/infrastructure/mock/shared/passwordHashMock";

let failed = false;
let counter = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failed = true;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`OK:   ${message}`);
  }
}

async function main() {
  const storage = new LocalStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const repo = new MockAuthRepository(store, eventBus, storage);

  function createLoginAccount(opts: {
    type: UserType;
    tenantId: string;
    email: string;
    password: string;
  }) {
    counter += 1;
    const userId = `user-mfa-${counter}`;
    const accountId = `auth-mfa-${counter}`;
    store.mutate((db) => {
      const roleId =
        opts.type === UserType.employee
          ? db.roles.find((role) => role.tenantId === opts.tenantId)?.id
          : undefined;
      if (opts.type === UserType.employee && !roleId) {
        throw new Error("El fixture Employee requiere un rol del mismo tenant.");
      }
      db.users.push({
        id: userId,
        tenantId: opts.tenantId,
        name: `MFA Test ${counter}`,
        email: opts.email,
        type: opts.type,
        status: UserStatus.active,
        roleId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      db.authAccounts.push({
        id: accountId,
        userId,
        email: opts.email,
        passwordHashMock: buildPasswordHashMock(opts.password),
        status: AccountStatus.active,
        failedLoginAttempts: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return undefined;
    });
    return { userId, accountId, email: opts.email, password: opts.password };
  }

  function enableMfaFor(userId: string, demoCode: string) {
    counter += 1;
    store.mutate((db) => {
      db.mfaEnrollments.push({
        id: `mfa-enrollment-${counter}`,
        userId,
        enabled: true,
        method: "totp",
        demoCodeMock: demoCode,
        verifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return undefined;
    });
  }

  function addRecoveryCode(userId: string, code: string) {
    counter += 1;
    store.mutate((db) => {
      db.recoveryCodes.push({
        id: `recovery-${counter}`,
        userId,
        code,
        used: false,
        createdAt: new Date().toISOString(),
      });
      return undefined;
    });
  }

  function getAccount(accountId: string) {
    return store.read((db) => db.authAccounts.find((a) => a.id === accountId)!);
  }

  function getChallenge(challengeId: string) {
    return store.read((db) => db.mfaChallenges.find((c) => c.id === challengeId));
  }

  function getRecoveryCode(userId: string, code: string) {
    return store.read((db) => db.recoveryCodes.find((r) => r.userId === userId && r.code === code));
  }

  function sessionsCountFor(userId: string) {
    return store.read((db) => db.sessions.filter((s) => s.userId === userId).length);
  }

  function loginSuccessCountFor(accountId: string) {
    return store.read(
      (db) =>
        db.auditLogs.filter((l) => l.entityId === accountId && l.action === "login_success").length,
    );
  }

  async function assertLoginThrows(input: Parameters<typeof repo.login>[0], message: string) {
    let threw = false;
    try {
      await repo.login(input);
    } catch {
      threw = true;
    }
    assert(threw, message);
  }

  async function assertVerifyDenied(
    challengeId: string,
    code: string,
    message: string,
  ): Promise<string> {
    let threw = false;
    let errMessage = "";
    try {
      await repo.verifyMfaChallenge(challengeId, code);
    } catch (error) {
      threw = true;
      errMessage = error instanceof Error ? error.message : "";
    }
    assert(threw, message);
    return errMessage;
  }

  async function requireMfaChallenge(
    input: Parameters<typeof repo.login>[0],
  ): Promise<{ challengeId: string; demoCodeMock: string }> {
    const result = await repo.login(input);
    if (result.status !== "mfa_required") {
      throw new Error("Se esperaba mfa_required en este escenario.");
    }
    return { challengeId: result.challengeId, demoCodeMock: result.demoCodeMock };
  }

  // ---------------------------------------------------------------
  // Escenario principal: ataque original + los 3 blockers, sobre un
  // Customer con MFA activo.
  // ---------------------------------------------------------------
  async function runLockoutHardeningScenario(userType: UserType, tenantId: string, label: string) {
    console.log(`\n--- Escenario MFA lockout hardening (${label}) ---`);

    const acc = createLoginAccount({
      type: userType,
      tenantId,
      email: `mfa-${label.toLowerCase()}-${counter}@example.com`,
      password: "CorrectPass1",
    });
    enableMfaFor(acc.userId, "111111");
    addRecoveryCode(acc.userId, "RECOVERY-CODE-1");

    const loginInput = { tenantId, email: acc.email, passwordMock: acc.password };
    const wrongLoginInput = { tenantId, email: acc.email, passwordMock: "WrongPass999" };

    console.log(`\n=== A: cuenta MFA, login correcto -> challenge (${label}) ===`);
    // 2 fallos de password ANTES de abrir el challenge -- necesarios para
    // que el contador COMPARTIDO llegue al umbral de lockout (5) antes que
    // el limite PROPIO del challenge (tambien 5), que es exactamente la
    // condicion de carrera que exploto el blocker 1.
    await assertLoginThrows(
      wrongLoginInput,
      `${label} A0: password incorrecta cuenta como intento 1`,
    );
    await assertLoginThrows(
      wrongLoginInput,
      `${label} A0: password incorrecta cuenta como intento 2`,
    );

    const { challengeId: challengeId1, demoCodeMock } = await requireMfaChallenge(loginInput);
    const challengeBefore = getChallenge(challengeId1)!;
    assert(
      challengeBefore.failedAttempts === 0,
      `${label} A: challenge nuevo con failedAttempts=0`,
    );
    assert(
      loginSuccessCountFor(acc.accountId) === 0,
      `${label} A: NO se registro login_success al abrir el challenge (no prematuro)`,
    );
    assert(
      sessionsCountFor(acc.userId) === 0,
      `${label} A: NO se creo Session al abrir el challenge`,
    );

    console.log(`\n=== B/C/D/E: reiniciar login mientras el challenge sigue vivo (${label}) ===`);
    await assertVerifyDenied(
      challengeId1,
      "000000",
      `${label} B: primer codigo MFA incorrecto se rechaza (reintentable)`,
    );
    const { challengeId: challengeId2 } = await requireMfaChallenge(loginInput);
    assert(
      challengeId2 === challengeId1,
      `${label} C: reiniciar login devuelve el MISMO challenge`,
    );
    const challengeAfterRestart = getChallenge(challengeId1)!;
    assert(
      challengeAfterRestart.failedAttempts === 1,
      `${label} D: failedAttempts NO vuelve a cero tras reiniciar (fue ${challengeAfterRestart.failedAttempts})`,
    );
    assert(
      challengeAfterRestart.expiresAt === challengeBefore.expiresAt,
      `${label} E: expiresAt (TTL) NO se renueva tras reiniciar`,
    );

    console.log(`\n=== F/G: seguir fallando MFA hasta el lockout de cuenta (${label}) ===`);
    // Van 2 fallos de password + 1 fallo MFA (el de arriba) = 3. Con 2
    // fallos MFA mas se llega a 5 acumulados -> lockout, y el challenge
    // queda en failedAttempts=3, todavia MUY por debajo de su propio
    // limite de 5 -- sigue "vivo".
    await assertVerifyDenied(challengeId1, "000000", `${label} F: segundo codigo MFA incorrecto`);
    await assertVerifyDenied(
      challengeId1,
      "000000",
      `${label} F: tercer codigo MFA incorrecto (5to fallo acumulado -> lockout)`,
    );

    const accLocked = getAccount(acc.accountId);
    assert(
      accLocked.status === AccountStatus.temporarily_locked,
      `${label} G: account.status === temporarily_locked`,
    );
    assert(Boolean(accLocked.lockedUntil), `${label} G: account.lockedUntil quedo seteado`);

    const challengeWhileLocked = getChallenge(challengeId1)!;
    assert(!challengeWhileLocked.consumedAt, `${label} G: el challenge sigue sin consumir`);
    assert(
      !challengeWhileLocked.invalidatedAt,
      `${label} G: el challenge sigue sin invalidar (failedAttempts=${challengeWhileLocked.failedAttempts} < 5)`,
    );

    console.log(
      `\n=== H: login con password correcta mientras esta locked -> DENIED (${label}) ===`,
    );
    const challengesCountBeforeH = store.read((db) => db.mfaChallenges.length);
    await assertLoginThrows(
      loginInput,
      `${label} H: login con password correcta se rechaza mientras la cuenta esta bloqueada`,
    );
    const challengesCountAfterH = store.read((db) => db.mfaChallenges.length);
    assert(
      challengesCountAfterH === challengesCountBeforeH,
      `${label} H: NO se creo un challenge nuevo mientras esta locked`,
    );

    console.log(
      `\n=== I: BLOCKER 1 -- codigo MFA correcto mientras esta locked -> DENIED (${label}) ===`,
    );
    const sessionsBeforeI = sessionsCountFor(acc.userId);
    const loginSuccessBeforeI = loginSuccessCountFor(acc.accountId);
    await assertVerifyDenied(
      challengeId1,
      demoCodeMock,
      `${label} I: codigo MFA CORRECTO se rechaza mientras la cuenta esta bloqueada (blocker 1)`,
    );
    assert(sessionsCountFor(acc.userId) === sessionsBeforeI, `${label} I: NO se creo Session`);
    assert(
      loginSuccessCountFor(acc.accountId) === loginSuccessBeforeI,
      `${label} I: NO se registro login_success`,
    );
    const challengeAfterI = getChallenge(challengeId1)!;
    assert(
      !challengeAfterI.consumedAt,
      `${label} I: el challenge NO quedo consumido por el intento rechazado`,
    );

    console.log(
      `\n=== J/K: BLOCKER 2 -- recovery code valido mientras esta locked -> DENIED, no se consume (${label}) ===`,
    );
    const sessionsBeforeJ = sessionsCountFor(acc.userId);
    await assertVerifyDenied(
      challengeId1,
      "RECOVERY-CODE-1",
      `${label} J: recovery code VALIDO se rechaza mientras la cuenta esta bloqueada (blocker 2)`,
    );
    assert(
      sessionsCountFor(acc.userId) === sessionsBeforeJ,
      `${label} J: NO se creo Session con el recovery code`,
    );
    const recoveryAfterJ = getRecoveryCode(acc.userId, "RECOVERY-CODE-1")!;
    assert(
      !recoveryAfterJ.used,
      `${label} K: el recovery code NO se consumio en el intento rechazado por lockout`,
    );

    console.log(`\n=== L: lockout expirado -> vuelve a ser coherente (${label}) ===`);
    store.mutate((db) => {
      const account = db.authAccounts.find((a) => a.id === acc.accountId)!;
      account.lockedUntil = new Date(Date.now() - 1000).toISOString();
      return undefined;
    });
    const { challengeId: challengeId3, demoCodeMock: demoCodeAfterUnlock } =
      await requireMfaChallenge(loginInput);
    assert(
      challengeId3 === challengeId1,
      `${label} L: challenge vivo se sigue reutilizando tras el auto-unlock (no se abre uno nuevo de mas)`,
    );
    const accAfterAutoUnlock = getAccount(acc.accountId);
    assert(
      accAfterAutoUnlock.status === AccountStatus.active,
      `${label} L: auto-unlock restaura status=active`,
    );
    assert(!accAfterAutoUnlock.lockedUntil, `${label} L: auto-unlock limpia lockedUntil`);

    console.log(
      `\n=== M: MFA correcto en cuenta YA NO bloqueada -> exito coherente (${label}) ===`,
    );
    const loginSuccessBeforeM = loginSuccessCountFor(acc.accountId);
    const sessionsBeforeM = sessionsCountFor(acc.userId);
    const session = await repo.verifyMfaChallenge(challengeId3, demoCodeAfterUnlock);
    assert(Boolean(session.id), `${label} M: verifyMfaChallenge exitoso devuelve una Session`);
    assert(
      sessionsCountFor(acc.userId) === sessionsBeforeM + 1,
      `${label} M: se creo exactamente 1 Session nueva`,
    );
    assert(
      loginSuccessCountFor(acc.accountId) === loginSuccessBeforeM + 1,
      `${label} M: se registro exactamente 1 login_success nuevo`,
    );
    const accAfterSuccess = getAccount(acc.accountId);
    assert(
      accAfterSuccess.status === AccountStatus.active,
      `${label} M: status queda active (blocker 3)`,
    );
    assert(!accAfterSuccess.lockedUntil, `${label} M: lockedUntil queda coherente (undefined)`);
    assert(accAfterSuccess.failedLoginAttempts === 0, `${label} M: failedLoginAttempts se resetea`);
    const challengeAfterSuccess = getChallenge(challengeId3)!;
    assert(Boolean(challengeAfterSuccess.consumedAt), `${label} M: el challenge queda consumido`);

    console.log(`\n=== N: reutilizar un challenge YA consumido -> DENIED (${label}) ===`);
    await assertVerifyDenied(
      challengeId3,
      demoCodeAfterUnlock,
      `${label} N: un challenge consumido no puede reutilizarse`,
    );

    return acc;
  }

  const custAcc = await runLockoutHardeningScenario(UserType.customer, "tenant-demo", "Customer");
  await runLockoutHardeningScenario(UserType.employee, "tenant-demo", "Employee");
  void custAcc;

  // ---------------------------------------------------------------
  // O/P: cuentas SIN MFA -- login directo y lockout por password
  // siguen funcionando exactamente igual que antes de este fix.
  // ---------------------------------------------------------------
  console.log("\n--- Escenario: cuenta SIN MFA (sin regresion) ---");
  {
    const acc = createLoginAccount({
      type: UserType.customer,
      tenantId: "tenant-demo",
      email: `no-mfa-${counter}@example.com`,
      password: "NoMfaPass123",
    });
    const result = await repo.login({
      tenantId: "tenant-demo",
      email: acc.email,
      passwordMock: acc.password,
    });
    assert(
      result.status === "authenticated",
      "O: cuenta sin MFA autentica directo (sin challenge)",
    );

    const accLockout = createLoginAccount({
      type: UserType.customer,
      tenantId: "tenant-demo",
      email: `no-mfa-lockout-${counter}@example.com`,
      password: "NoMfaLockPass1",
    });
    const wrongInput = {
      tenantId: "tenant-demo",
      email: accLockout.email,
      passwordMock: "Wrong999",
    };
    for (let i = 0; i < 5; i += 1) {
      await assertLoginThrows(wrongInput, `P: password incorrecta ${i + 1}/5 se rechaza`);
    }
    const accLockedAfter = getAccount(accLockout.accountId);
    assert(
      accLockedAfter.status === AccountStatus.temporarily_locked,
      "P: lockout por password sigue funcionando igual (5 fallos -> temporarily_locked)",
    );
  }

  // ---------------------------------------------------------------
  // Recovery code: one-time real (se consume una sola vez), sin
  // relacion con lockout.
  // ---------------------------------------------------------------
  console.log("\n--- Escenario: recovery code one-time (sin lockout de por medio) ---");
  {
    const acc = createLoginAccount({
      type: UserType.customer,
      tenantId: "tenant-demo",
      email: `recovery-onetime-${counter}@example.com`,
      password: "RecoveryPass1",
    });
    enableMfaFor(acc.userId, "222222");
    addRecoveryCode(acc.userId, "RECOVERY-ONETIME-1");
    const loginInput = { tenantId: "tenant-demo", email: acc.email, passwordMock: acc.password };

    const { challengeId: challengeA } = await requireMfaChallenge(loginInput);
    const session = await repo.verifyMfaChallenge(challengeA, "RECOVERY-ONETIME-1");
    assert(Boolean(session.id), "recovery code valido completa el login la primera vez");
    const recoveryAfterFirstUse = getRecoveryCode(acc.userId, "RECOVERY-ONETIME-1")!;
    assert(recoveryAfterFirstUse.used, "el recovery code queda marcado used=true");

    const { challengeId: challengeB } = await requireMfaChallenge(loginInput);
    await assertVerifyDenied(
      challengeB,
      "RECOVERY-ONETIME-1",
      "reusar el mismo recovery code en un challenge NUEVO -> rechazo",
    );
    const recoveryAfterReuse = getRecoveryCode(acc.userId, "RECOVERY-ONETIME-1")!;
    assert(
      recoveryAfterReuse.used,
      "el recovery code sigue used=true (no se revirtio por el intento fallido)",
    );
  }

  console.log(failed ? "\nHay FAILs arriba, revisar." : "\nTodo OK.");
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
