import {
  AccountStatus,
  CustomerStatus,
  NotificationChannel,
  NotificationStatus,
  RoleStatus,
  TenantStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type {
  AuthAccount,
  Customer,
  MfaChallenge,
  MfaEnrollment,
  MfaMethod,
  Session,
} from "@/core/entities";
import type { AuthRepository } from "@/core/repositories";
import { MfaChallengeUnavailableError } from "@/core/repositories/AuthRepository";
import {
  EMAIL_ALREADY_REGISTERED_MESSAGE,
  EMAIL_VERIFICATION_TOKEN_MINUTES,
  EMPLOYEE_INVITATION_TOKEN_HOURS,
  GENERIC_AUTH_ERROR_MESSAGE,
  LOGIN_ATTEMPT_RULES,
  FAILED_ATTEMPTS_WINDOW_MINUTES,
  LOCKOUT_ESCALATION_LOOKBACK_HOURS,
  LOCKOUT_RESET_AFTER_MINUTES,
  PASSWORD_RESET_COOLDOWN_MINUTES,
  PASSWORD_RESET_REQUEST_LIMIT,
  PASSWORD_RESET_TOKEN_MINUTES,
  PasswordPolicyError,
  getLockoutMinutesForOccurrence,
  isPasswordRecoveryEligible,
  validateCustomerPassword,
  validateEmployeePassword,
} from "@/config/auth-policy";
import {
  MFA_CHALLENGE_EXPIRATION_MINUTES,
  MFA_CHALLENGE_MAX_ATTEMPTS,
  MFA_CODE_DIGITS,
  RECOVERY_CODES_COUNT,
} from "@/config/mfa-policy";
import { sessionPolicy } from "@/config/session-policy";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import type { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { buildPasswordHashMock } from "@/infrastructure/mock/shared/passwordHashMock";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { canUserOperateBranch } from "@/core/scopes/userBranchAccess";
import { BranchStatus } from "@/core/enums";
import { getMockSessionStorageKey } from "@/infrastructure/storage/storageKeys";
export class MockAuthRepository extends BaseMockRepository implements AuthRepository {
  private readonly sessionStorage: LocalStorageAdapter;

  constructor(
    store: MockDatabaseStore,
    eventBus: DataEventBus,
    sessionStorage: LocalStorageAdapter,
  ) {
    super(store, eventBus);
    this.sessionStorage = sessionStorage;
  }

  async login(input: Parameters<AuthRepository["login"]>[0]) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const now = new Date();
    const expectedHash = buildPasswordHashMock(input.passwordMock);

    const outcome = this.store.mutate((db) => {
      const ownerOf = (account: AuthAccount) => db.users.find((user) => user.id === account.userId);
      const matchesEmail = (account: AuthAccount) =>
        account.email.toLowerCase() === normalizedEmail;

      // Candidatos CUSTOMER: tenant-scoped al storefront actual (R-A03: email
      // unico POR TENANT). Sin tenantId resuelto (storefront no disponible)
      // no hay candidato Customer -- a diferencia de Employee/Admin, el
      // login de Customer SI depende genuinamente de que el storefront
      // publico se haya podido resolver.
      const customerCandidates = input.tenantId
        ? db.authAccounts.filter((account) => {
            if (!matchesEmail(account)) return false;
            const owner = ownerOf(account);
            return owner?.type === UserType.customer && owner.tenantId === input.tenantId;
          })
        : [];

      // Candidatos OPERATIONAL: Employee/Admin, SIN restriccion de tenant --
      // el login operacional no depende de cual storefront publico este
      // cargado en el navegador (ver doc completo en AuthRepository.
      // LoginInput.tenantId).
      const operationalCandidates = db.authAccounts.filter(
        (account) => matchesEmail(account) && ownerOf(account)?.type === UserType.employee,
      );

      // expectedUserType NO se aplica aca: filtrar candidatos antes de
      // resolver identidad cambiaria silenciosamente el resultado de una
      // colision de email (una cuenta ya descartada por tipo no deberia
      // poder "desambiguar" a las demas). Se valida mas abajo, junto al
      // password, con la misma contabilidad de intento fallido/lockout.
      const candidates = [...customerCandidates, ...operationalCandidates];

      // Identidad resuelta por CONTEXTO + CREDENCIALES, nunca por "primer
      // match": una cuenta encontrada primero (p.ej. un Customer del tenant
      // actual) jamas debe opacar a otra cuenta valida (p.ej. un Employee de
      // otro tenant) que comparta el mismo email. Con un unico candidato se
      // evalua ese directamente (mismo comportamiento de siempre). Con
      // varios (colision real de email entre cuentas independientes), solo
      // se resuelve identidad si la contraseña identifica a UNA sola cuenta
      // de forma inequivoca -- si ninguna coincide, o si dos cuentas
      // independientes ademas comparten password mock, no hay forma segura
      // de saber cual se intentaba autenticar: fallo generico, sin tocar el
      // estado de ninguna candidata (no se puede castigar/premiar
      // selectivamente a una cuenta cuando ni siquiera se sabe cual era el
      // objetivo real del intento).
      let account: AuthAccount | undefined;
      if (candidates.length === 1) {
        account = candidates[0];
      } else if (candidates.length > 1) {
        const passwordMatches = candidates.filter((item) => item.passwordHashMock === expectedHash);
        account = passwordMatches.length === 1 ? passwordMatches[0] : undefined;
      }

      if (!account) {
        return { ok: false as const };
      }

      const user = ownerOf(account);
      const tenantId = user?.tenantId ?? "tenant-demo";

      // Auto-unlock if the lockout window already elapsed.
      this.applyAutoUnlockIfExpired(account, now);

      if (account.status !== AccountStatus.active) {
        this.logAuthAudit(db, {
          tenantId,
          actorUserId: account.userId,
          accountId: account.id,
          action: "login_failed",
        });
        return { ok: false as const };
      }

      const passwordMatches = account.passwordHashMock === expectedHash;
      // Doc rule R-A13 (never reveal which credential/check failed) extends
      // to the account-kind check: a wrong password and a "right password,
      // wrong expected kind" attempt must be completely indistinguishable
      // from the outside — same generic error, same failed-attempt/lockout
      // accounting. Do NOT split this into a separate branch or message
      // later, even if it seems like better UX.
      const accountKindMatches = !input.expectedUserType || user?.type === input.expectedUserType;

      if (!passwordMatches || !accountKindMatches) {
        this.registerFailedAuthAttempt(db, account, tenantId, "login_failed");
        return { ok: false as const };
      }

      if (user?.type === UserType.employee && !this.isValidOperationalUser(db, user.id)) {
        this.logAuthAudit(db, {
          tenantId,
          actorUserId: account.userId,
          accountId: account.id,
          action: "login_failed",
        });
        return { ok: false as const };
      }

      account.lastLoginAt = now.toISOString();
      account.updatedAt = now.toISOString();

      // PR13 (doc R-A16): "si la cuenta exige MFA, la contraseña correcta
      // no crea sesión definitiva hasta completar el segundo factor" --
      // la Session todavía no se crea, en su lugar se abre un
      // MfaChallenge efímero.
      const enrollment = db.mfaEnrollments.find(
        (item) => item.userId === account.userId && item.enabled,
      );
      if (enrollment) {
        // PR14 (cierre de hueco de seguridad):
        //
        // 1. "login_success" se registra recién en verifyMfaChallenge(),
        //    NO acá -- si se registrara acá (como hacía antes de este
        //    PR), cada reinicio de login() con la contraseña correcta
        //    generaría un login_success nuevo, y registerFailedAuthAttempt
        //    usa el login_success MÁS RECIENTE como límite para qué
        //    fallos siguen contando ("lastSuccessAt" mas abajo) -- eso
        //    borraría en silencio los fallos de MFA acumulados antes del
        //    reinicio.
        // 2. Se reutiliza un challenge ya vivo en vez de crear uno con el
        //    contador de intentos en cero -- antes, reiniciar login()
        //    regalaba una ventana nueva de MFA_CHALLENGE_MAX_ATTEMPTS
        //    intentos cada vez, indefinidamente, porque
        //    failedLoginAttempts/lockedUntil se reseteaban aca abajo
        //    apenas la password era correcta, sin relacion con los
        //    fallos de codigo MFA (que vivian solo en
        //    challenge.failedAttempts, un contador completamente aparte).
        //
        // Ambos puntos juntos cierran el bypass: aunque el challenge se
        // reutilice y ningun login_success interrumpa la racha, la
        // cuenta sigue acumulando fallos compartidos
        // (registerFailedAuthAttempt, llamado tambien desde
        // verifyMfaChallenge) hasta el umbral de LOGIN_ATTEMPT_RULES, que
        // bloquea la cuenta entera.
        const liveChallenge = db.mfaChallenges.find(
          (item) =>
            item.userId === account.userId &&
            !item.consumedAt &&
            !item.invalidatedAt &&
            now < new Date(item.expiresAt),
        );
        const challenge =
          liveChallenge ??
          this.createMfaChallenge(db, enrollment, {
            rememberMe: Boolean(input.rememberMe),
            deviceLabel: input.deviceLabel,
          });
        return { ok: true as const, kind: "mfa_challenge" as const, challenge, enrollment };
      }

      // Cuenta sin MFA: sin cambio de comportamiento -- login_success se
      // registra y el reset sigue pasando inmediatamente, acá mismo.
      this.logAuthAudit(db, {
        tenantId,
        actorUserId: account.userId,
        accountId: account.id,
        action: "login_success",
      });
      account.failedLoginAttempts = 0;
      account.lockedUntil = undefined;

      const expires = new Date(
        now.getTime() +
          (input.rememberMe
            ? sessionPolicy.rememberMeDays * 24
            : sessionPolicy.normalSessionHours) *
            60 *
            60 *
            1000,
      );
      const created = {
        id: this.id("session"),
        userId: account.userId,
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        rememberMe: Boolean(input.rememberMe),
        deviceLabel: input.deviceLabel,
      };
      db.sessions.push(created);
      return { ok: true as const, kind: "session" as const, session: created };
    });

    if (!outcome.ok) {
      throw new Error(GENERIC_AUTH_ERROR_MESSAGE);
    }

    if (outcome.kind === "mfa_challenge") {
      // Sin sesión todavía -- no se toca sessionStorage ni se emite
      // auth.changed (desde afuera, nadie quedó autenticado todavía).
      return {
        status: "mfa_required" as const,
        challengeId: outcome.challenge.id,
        method: outcome.challenge.method,
        demoCodeMock: outcome.enrollment.demoCodeMock,
      };
    }

    // El puntero persistido es la fuente canonica que consumen todos los
    // observadores de auth.changed. Debe quedar actualizado ANTES del
    // evento; de lo contrario CurrentSessionProvider reconstruye la
    // identidad anterior y no recibe otra senal para corregirse.
    this.sessionStorage.set(getMockSessionStorageKey(), outcome.session.id);
    this.emit("auth.changed", { entityId: outcome.session.id, action: "created" });
    return { status: "authenticated" as const, session: outcome.session };
  }
  async verifyMfaChallenge(challengeId: string, codeMock: string) {
    const outcome = this.store.mutate((db) => {
      const now = new Date();
      const challenge = db.mfaChallenges.find((item) => item.id === challengeId);
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.invalidatedAt ||
        now >= new Date(challenge.expiresAt)
      ) {
        // No hay challenge vivo sobre el que reintentar -- distinto de un
        // código incorrecto con intentos restantes (ver abajo).
        return { ok: false as const, retriable: false };
      }

      const user = db.users.find((item) => item.id === challenge.userId);
      const account = db.authAccounts.find((item) => item.userId === challenge.userId);
      const tenantId = user?.tenantId ?? "tenant-demo";

      // Hardening post-auditoria (PR14): un challenge puede seguir "vivo"
      // (sus propios MFA_CHALLENGE_MAX_ATTEMPTS todavia no se agotaron)
      // aunque la cuenta YA este bloqueada -- el contador compartido de
      // registerFailedAuthAttempt (login_failed + mfa_failed juntos) puede
      // alcanzar el umbral de lockout antes que el limite propio del
      // challenge. Sin este chequeo, un codigo MFA o recovery code
      // correcto completaba la autenticacion igual, evadiendo el lockout
      // que se acababa de aplicar. account.status es la MISMA fuente de
      // verdad que usa login() (via applyAutoUnlockIfExpired) -- no se
      // duplica la regla de tiempo/ventana, solo se consulta aca tambien.
      if (account) {
        this.applyAutoUnlockIfExpired(account, now);
        if (account.status !== AccountStatus.active) {
          // No se toca el challenge ni se llama a consumeMfaCode: un
          // recovery code valido NO debe consumirse en un intento que de
          // todos modos se va a rechazar, y el codigo MFA es reutilizable
          // (no tiene sentido "gastarlo" en un rechazo). El mensaje al
          // usuario es el mismo "challenge ya no disponible" que cuando
          // expira -- reintentar login() desde cero mostrara el error
          // generico de siempre (R-A13: no revelar que la causa fue
          // lockout).
          return { ok: false as const, retriable: false };
        }
      }

      if (user?.type === UserType.employee && !this.isValidOperationalUser(db, user.id)) {
        return { ok: false as const, retriable: false };
      }

      const codeIsValid = this.consumeMfaCode(db, challenge.userId, codeMock);
      if (!codeIsValid) {
        // challenge.failedAttempts sigue siendo su propio contador (5 por
        // challenge, doc 4.12) -- PERO desde PR14, ADEMAS se contabiliza
        // en el contador compartido de la cuenta (registerFailedAuthAttempt,
        // el mismo que usa login() para contraseñas incorrectas). Antes
        // este fallo nunca tocaba account.failedLoginAttempts, lo que
        // permitia reiniciar login() indefinidamente para conseguir una
        // ventana nueva de intentos sin que la cuenta se bloqueara jamas
        // (ver seccion 2 del spec de este PR).
        challenge.failedAttempts += 1;
        if (account) {
          this.registerFailedAuthAttempt(db, account, tenantId, "mfa_failed");
        }
        const exceededAttempts = challenge.failedAttempts >= MFA_CHALLENGE_MAX_ATTEMPTS;
        if (exceededAttempts) {
          challenge.invalidatedAt = this.now();
        }
        // retriable=true en los intentos 1..4 (doc 4.12/QA: "challenge
        // sigue vivo"); false en el intento que alcanza el máximo -- ahí
        // el challenge ya quedó invalidado arriba, no hay nada que
        // reintentar con este mismo challengeId.
        return { ok: false as const, retriable: !exceededAttempts };
      }

      challenge.consumedAt = this.now();

      // PR14 (cierre de hueco de seguridad): para cuentas con MFA,
      // login_success recién se registra acá (no en login(), ver
      // comentario ahí) y el reset de failedLoginAttempts/lockedUntil
      // también se difiere hasta acá -- antes ambos pasaban apenas la
      // contraseña era correcta, en login(), sin relación con los
      // fallos de código MFA.
      if (account) {
        this.logAuthAudit(db, {
          tenantId,
          actorUserId: account.userId,
          accountId: account.id,
          action: "login_success",
        });
        account.status = AccountStatus.active;
        account.failedLoginAttempts = 0;
        account.lockedUntil = undefined;
        account.updatedAt = this.now();
      }

      // Misma formula de vigencia que login() -- rememberMe/deviceLabel
      // vienen del LoginInput original, capturados en el challenge porque
      // este método solo recibe challengeId + código.
      const expires = new Date(
        now.getTime() +
          (challenge.rememberMe
            ? sessionPolicy.rememberMeDays * 24
            : sessionPolicy.normalSessionHours) *
            60 *
            60 *
            1000,
      );
      const session: Session = {
        id: this.id("session"),
        userId: challenge.userId,
        createdAt: this.now(),
        expiresAt: expires.toISOString(),
        rememberMe: challenge.rememberMe,
        deviceLabel: challenge.deviceLabel,
      };
      db.sessions.push(session);
      return { ok: true as const, session };
    });

    if (!outcome.ok) {
      if (outcome.retriable) {
        throw new Error("El código no es correcto. Inténtalo de nuevo.");
      }
      // No es un caso de enumeración cross-account (R-A13 es sobre no
      // revelar si una cuenta/correo existe) -- es solo el ciclo de vida
      // del challenge para un usuario que YA se autenticó con
      // contraseña. Distinguirlo de un código simplemente incorrecto es
      // información útil, no un riesgo: le dice al usuario que reintentar
      // con este mismo challenge ya no sirve.
      throw new MfaChallengeUnavailableError();
    }

    this.sessionStorage.set(getMockSessionStorageKey(), outcome.session.id);
    this.emit("auth.changed", { entityId: outcome.session.id, action: "created" });
    return outcome.session;
  }
  /**
   * El mock no envia correos: devuelve el mismo demoCodeMock del enrollment
   * (no rotativo). Mismas reglas que el backend: solo con un desafio vivo y
   * metodo `email`.
   */
  /** El mock no habla con Google: "Continuar con Google" no esta disponible. */
  loginWithGoogle(): Promise<never> {
    return Promise.reject(new Error("Inicio de sesión con Google no disponible."));
  }
  async resendMfaChallengeCode(challengeId: string) {
    return this.read((db) => {
      const now = new Date();
      const challenge = db.mfaChallenges.find((item) => item.id === challengeId);
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.invalidatedAt ||
        now >= new Date(challenge.expiresAt)
      ) {
        throw new MfaChallengeUnavailableError();
      }
      if (challenge.method !== "email") {
        throw new Error("El código se genera en tu app autenticadora.");
      }
      const enrollment = db.mfaEnrollments.find(
        (item) => item.userId === challenge.userId && item.enabled,
      );
      if (!enrollment) throw new MfaChallengeUnavailableError();
      return { demoCodeMock: enrollment.demoCodeMock };
    });
  }
  async beginMfaEnrollment(sessionId: string, method: MfaMethod) {
    return this.store.mutate((db) => {
      const session = this.requireActiveSession(db, sessionId);
      const now = this.now();
      const demoCodeMock = this.generateMfaCodeMock();
      const existing = db.mfaEnrollments.find((item) => item.userId === session.userId);
      if (existing) {
        // Reinicia el enrollment (mismo criterio que reenviar una
        // invitación): un enrollment sin confirmar previamente no deja
        // basura -- se reemplaza el método/código y se vuelve a pedir
        // verificación.
        existing.method = method;
        existing.demoCodeMock = demoCodeMock;
        existing.enabled = false;
        existing.verifiedAt = undefined;
        existing.updatedAt = now;
      } else {
        db.mfaEnrollments.push({
          id: this.id("mfa-enrollment"),
          userId: session.userId,
          enabled: false,
          method,
          demoCodeMock,
          verifiedAt: undefined,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { demoCodeMock };
    });
  }
  async verifyMfaEnrollment(sessionId: string, codeMock: string) {
    const outcome = this.store.mutate((db) => {
      const session = this.requireActiveSession(db, sessionId);
      const enrollment = db.mfaEnrollments.find((item) => item.userId === session.userId);
      if (!enrollment || enrollment.enabled) {
        throw new Error("No hay una verificación en dos pasos pendiente de confirmar.");
      }
      if (enrollment.demoCodeMock !== codeMock) {
        throw new Error("El código no es correcto.");
      }

      const now = this.now();
      enrollment.enabled = true;
      enrollment.verifiedAt = now;
      enrollment.updatedAt = now;

      // Reemplaza cualquier lote previo -- un enrollment recién confirmado
      // empieza con un set de recovery codes limpio, nunca mezclado con
      // códigos de un enrollment anterior ya desactivado.
      db.recoveryCodes = db.recoveryCodes.filter((item) => item.userId !== session.userId);
      const recoveryCodes = Array.from({ length: RECOVERY_CODES_COUNT }, () =>
        this.generateRecoveryCode(),
      );
      recoveryCodes.forEach((code) => {
        db.recoveryCodes.push({
          id: this.id("recovery-code"),
          userId: session.userId,
          code,
          used: false,
          createdAt: now,
        });
      });

      const user = db.users.find((item) => item.id === session.userId);
      const account = db.authAccounts.find((item) => item.userId === session.userId);
      const tenantId = user?.tenantId ?? "tenant-demo";
      this.logAuthAudit(db, {
        tenantId,
        actorUserId: session.userId,
        accountId: account?.id,
        action: "mfa_enabled",
      });
      db.notifications.push({
        id: this.id("notification"),
        tenantId,
        userId: session.userId,
        channel: NotificationChannel.in_app,
        type: "mfa_enabled",
        title: "Verificación en dos pasos activada",
        message: "Se activó la verificación en dos pasos en tu cuenta.",
        status: NotificationStatus.unread,
        relatedEntityType: "AuthAccount",
        relatedEntityId: account?.id,
        createdAt: now,
      });

      return { recoveryCodes };
    });
    // "mfa.changed", NO "auth.changed" -- ver comentario en DataEventName
    // (core/types/events.types.ts): esto no cambia identidad ni permisos,
    // y auth.changed remontaria el subarbol autenticado a mitad del
    // wizard de activacion.
    this.emit("mfa.changed", { action: "updated" });
    return outcome;
  }
  async disableMfa(sessionId: string, currentPasswordMock: string) {
    this.store.mutate((db) => {
      const session = this.requireActiveSession(db, sessionId);
      const account = db.authAccounts.find((item) => item.userId === session.userId);
      if (!account) throw new Error("No se encontró la cuenta.");
      if (account.passwordHashMock !== buildPasswordHashMock(currentPasswordMock)) {
        throw new Error("La contraseña actual no es correcta.");
      }
      const enrollment = db.mfaEnrollments.find((item) => item.userId === session.userId);
      if (!enrollment || !enrollment.enabled) {
        return undefined;
      }

      const now = this.now();
      enrollment.enabled = false;
      enrollment.updatedAt = now;

      const user = db.users.find((item) => item.id === session.userId);
      const tenantId = user?.tenantId ?? "tenant-demo";
      this.logAuthAudit(db, {
        tenantId,
        actorUserId: session.userId,
        accountId: account.id,
        // No está en la lista literal de R-A30, pero omitir un evento de
        // auditoría para un cambio de seguridad tan sensible como apagar
        // el segundo factor sería un hueco real -- mismo criterio que ya
        // se usó antes en este proyecto para la notificación de
        // account_locked, que el documento tampoco pedía explícitamente.
        action: "mfa_disabled",
      });
      db.notifications.push({
        id: this.id("notification"),
        tenantId,
        userId: session.userId,
        channel: NotificationChannel.in_app,
        type: "mfa_disabled",
        title: "Verificación en dos pasos desactivada",
        message: "Se desactivó la verificación en dos pasos en tu cuenta.",
        status: NotificationStatus.unread,
        relatedEntityType: "AuthAccount",
        relatedEntityId: account.id,
        createdAt: now,
      });
      return undefined;
    });
    // Ver comentario en verifyMfaEnrollment: "mfa.changed", no
    // "auth.changed".
    this.emit("mfa.changed", { action: "updated" });
  }
  async getMfaStatus(sessionId: string) {
    return this.read((db) => {
      const session = db.sessions.find((item) => item.id === sessionId && !item.revokedAt);
      if (!session) return null;
      const enrollment = db.mfaEnrollments.find((item) => item.userId === session.userId);
      if (!enrollment) return null;
      return { enabled: enrollment.enabled, method: enrollment.method };
    });
  }
  /** Solo con el MFA por correo activo; el mock devuelve el demoCodeMock en vez de enviarlo. */
  async requestMfaActionCode(sessionId: string) {
    return this.read((db) => {
      const session = this.requireActiveSession(db, sessionId);
      const enrollment = db.mfaEnrollments.find(
        (item) => item.userId === session.userId && item.enabled && item.method === "email",
      );
      if (!enrollment) {
        throw new Error("Tu verificación en dos pasos no usa códigos por correo.");
      }
      return { demoCodeMock: enrollment.demoCodeMock };
    });
  }
  async logout(sessionId: string) {
    this.store.mutate((db) => {
      const session = db.sessions.find((item) => item.id === sessionId);
      if (session) session.revokedAt = this.now();
      return undefined;
    });
    if (this.sessionStorage.get<string>(getMockSessionStorageKey()) === sessionId) {
      this.sessionStorage.remove(getMockSessionStorageKey());
    }
    this.emit("auth.changed", { entityId: sessionId, action: "updated" });
  }
  async getSession(sessionId: string) {
    const session = this.read((db) => db.sessions.find((item) => item.id === sessionId) ?? null);
    const isStale =
      !session || Boolean(session.revokedAt) || new Date() >= new Date(session.expiresAt);
    if (isStale) {
      if (this.sessionStorage.get<string>(getMockSessionStorageKey()) === sessionId) {
        this.sessionStorage.remove(getMockSessionStorageKey());
      }
      return null;
    }
    return session;
  }
  async getCurrentSessionId(): Promise<string | null> {
    return this.sessionStorage.get<string>(getMockSessionStorageKey());
  }
  async setActiveBranchId(branchId: string): Promise<void> {
    const sessionId = await this.getCurrentSessionId();
    if (!sessionId) throw new Error("An active session is required to select a branch");
    this.store.mutate((db) => {
      const session = db.sessions.find((item) => item.id === sessionId && !item.revokedAt &&
        new Date(item.expiresAt) > new Date());
      const user = db.users.find((item) => item.id === session?.userId &&
        item.status === UserStatus.active && item.type === UserType.employee);
      const branch = db.branches.find((item) => item.id === branchId &&
        item.status === BranchStatus.active);
      if (!session || !user || !branch || !canUserOperateBranch(user, branch)) {
        throw new Error("The selected branch is not authorized for this session");
      }
      session.activeBranchId = branch.id;
    });
  }
  async clearLocalSession(): Promise<void> {
    this.sessionStorage.remove(getMockSessionStorageKey());
    this.emit("auth.changed", { action: "updated" });
  }
  async registerCustomer(input: Parameters<AuthRepository["registerCustomer"]>[0]) {
    // Password policy en la capa funcional (mismo patron que
    // resetPassword/activateEmployeeAccount/changePassword): antes de
    // este ajuste, registerCustomer() no validaba nada de esto -- solo
    // el formulario (register.validation.ts) lo hacia, asi que una
    // llamada directa a este metodo podia crear una cuenta con
    // cualquier contraseña, incluida una compuesta solo de digitos.
    const passwordError = validateCustomerPassword(input.passwordMock, input.email);
    if (passwordError) {
      throw new PasswordPolicyError(passwordError);
    }
    const result = this.store.mutate((db) => {
      const now = this.now();
      const normalizedEmail = input.email.trim().toLowerCase();

      // El tenant NO es un parametro que el caller elija -- no existe
      // forma de pasarlo. Se resuelve aca mismo, con la MISMA fuente de
      // verdad que usa PublicTenantProvider en el cliente (el slug del
      // unico storefront publico), para que no exista ninguna via de
      // "sustituir" el tenant de un registro publico. Revalidar que
      // ademas este activo es la misma garantia de siempre: un dato que
      // pueda haber cambiado nunca es autoridad por si solo.
      const tenant = db.tenants.find(
        (item) => item.slug === input.tenantSlug && item.status === TenantStatus.active,
      );
      if (!tenant) {
        throw new Error("No se pudo completar el registro.");
      }
      const tenantId = tenant.id;

      // R-A03: email unico dentro del tenant. Se resuelve via AuthAccount
      // (la credencial real) cruzando con User.tenantId, porque
      // AuthAccount no guarda tenantId directamente. Se comprueba ANTES
      // de crear cualquier entidad: un intento rechazado no debe dejar un
      // Customer/User/AuthAccount a medias en el store. Resuelto en PR8:
      // este metodo nacio en un PR solo de contrato, sin ninguna pantalla
      // que lo alcanzara -- PR8 expone un formulario real y el gap deja
      // de ser teorico.
      const existingAccountInTenant = db.authAccounts.find((account) => {
        if (account.email.toLowerCase() !== normalizedEmail) return false;
        const owner = db.users.find((item) => item.id === account.userId);
        return owner?.tenantId === tenantId;
      });
      if (existingAccountInTenant) {
        throw new Error(EMAIL_ALREADY_REGISTERED_MESSAGE);
      }

      const customer: Customer = {
        id: this.id("customer"),
        tenantId,
        code: `CLI-${db.customers.length + 1}`,
        name: input.name,
        email: input.email,
        phone: input.phone,
        status: CustomerStatus.active,
        createdAt: now,
        updatedAt: now,
      };
      const customerRole = db.roles.find(
        (role) =>
          role.tenantId === tenantId &&
          role.isSystem &&
          role.permissions.includes("customer.account.read") &&
          !role.permissions.some(
            (p) => p.startsWith("admin.") || p.startsWith("pos.") || p.startsWith("inventory."),
          ),
      );

      if (!customerRole) {
        throw new Error("Critical: Missing canonical Customer system role in tenant.");
      }

      const createdUser = {
        id: this.id("user"),
        tenantId,
        customerId: customer.id,
        name: input.name,
        email: input.email,
        phone: input.phone,
        type: UserType.customer,
        status: UserStatus.active,
        roleId: customerRole.id,
        createdAt: now,
        updatedAt: now,
      };
      customer.userId = createdUser.id;
      db.customers.push(customer);
      db.users.push(createdUser);
      db.authAccounts.push({
        id: this.id("auth"),
        userId: createdUser.id,
        email: input.email,
        passwordHashMock: buildPasswordHashMock(input.passwordMock),
        status: AccountStatus.pending_verification,
        failedLoginAttempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      // Doc 4.10: without this record, verifyEmail() (which reads
      // db.emailVerifications) has nothing to ever match, so a new
      // customer could never leave pending_verification.
      const verification = {
        id: this.id("email-verification"),
        userId: createdUser.id,
        token: this.id("token"),
        createdAt: now,
        expiresAt: new Date(
          Date.now() + EMAIL_VERIFICATION_TOKEN_MINUTES * 60 * 1000,
        ).toISOString(),
      };
      db.emailVerifications.push(verification);
      // El token demo viaja solo como parte del resultado de ESTE
      // registro (registration-scoped) -- no queda ningun metodo que
      // permita pedirlo despues por userId (ver AuthRepository.
      // RegisterCustomerResult: asi se cierra el oraculo
      // cross-account/cross-tenant que existia antes).
      return { user: createdUser, emailVerificationToken: verification.token };
    });
    this.emit("auth.changed", {
      entityId: result.user.id,
      tenantId: result.user.tenantId,
      action: "created",
    });
    this.emit("customer.changed", {
      entityId: result.user.customerId,
      tenantId: result.user.tenantId,
      action: "created",
    });
    return result;
  }
  async requestPasswordReset(input: Parameters<AuthRepository["requestPasswordReset"]>[0]) {
    this.store.mutate((db) => {
      const normalizedEmail = input.email.trim().toLowerCase();
      const now = new Date();
      const matchesEmail = (account: AuthAccount) =>
        account.email.toLowerCase() === normalizedEmail;
      const ownerOf = (account: AuthAccount) => db.users.find((u) => u.id === account.userId);

      // Mismo criterio de candidatos que login(). A diferencia de login(),
      // aquí NO hay contraseña para desambiguar -- no hace falta: no se
      // autentica como una sola cuenta, se genera un challenge por CADA
      // cuenta que coincida.
      const customerCandidates = input.tenantId
        ? db.authAccounts.flatMap((account) => {
            if (!matchesEmail(account)) return [];
            const owner = ownerOf(account);
            return owner?.type === UserType.customer && owner.tenantId === input.tenantId
              ? [{ account, owner }]
              : [];
          })
        : [];
      const operationalCandidates = db.authAccounts.flatMap((account) => {
        if (!matchesEmail(account)) return [];
        const owner = ownerOf(account);
        return owner?.type === UserType.employee ? [{ account, owner }] : [];
      });
      const candidates = [...customerCandidates, ...operationalCandidates];

      for (const { account, owner } of candidates) {
        // Recovery y activation/verification son máquinas de estado
        // SEPARADAS (ver PASSWORD_RECOVERY_ELIGIBLE_STATUSES) -- una
        // cuenta password_reset_required (invitación de empleado sin
        // activar, PR9) o pending_verification (registro de cliente sin
        // verificar, PR8) NUNCA debe poder salir de ese estado via
        // recovery, o recovery se convierte en un atajo que se salta
        // activateEmployeeAccount()/verifyEmail() por completo. Se omite
        // en silencio, igual que el rate limiting -- no hay señal
        // distinguible hacia afuera (R-A19).
        if (!isPasswordRecoveryEligible(account.status)) {
          continue;
        }

        const existingForAccount = db.passwordResetChallenges.filter(
          (c) => c.userId === account.userId,
        );

        // R-A21 (simplificado, ver auth-policy.ts): máximo
        // PASSWORD_RESET_REQUEST_LIMIT solicitudes dentro de los últimos
        // PASSWORD_RESET_COOLDOWN_MINUTES.
        const recentCount = existingForAccount.filter(
          (c) =>
            now.getTime() - new Date(c.createdAt).getTime() <
            PASSWORD_RESET_COOLDOWN_MINUTES * 60 * 1000,
        ).length;
        if (recentCount >= PASSWORD_RESET_REQUEST_LIMIT) {
          continue; // rate-limited: no se crea challenge para esta cuenta, en silencio (R-A19)
        }

        // Doc 4.10: "una nueva solicitud invalida el enlace anterior" --
        // a diferencia de EmployeeInvitation (PR9), que sí permite que
        // convivan varias vigentes.
        existingForAccount
          .filter((c) => !c.usedAt && !c.supersededAt)
          .forEach((c) => {
            c.supersededAt = now.toISOString();
          });

        db.passwordResetChallenges.push({
          id: this.id("password-reset"),
          userId: account.userId,
          token: this.id("token"),
          createdAt: now.toISOString(),
          expiresAt: new Date(
            now.getTime() + PASSWORD_RESET_TOKEN_MINUTES * 60 * 1000,
          ).toISOString(),
        });

        // password_reset_requested es una solicitud publica NO
        // autenticada -- a diferencia de login_success/session_revoked
        // (donde el propio dueño de la cuenta es, de hecho, el actor),
        // acá quien envia el formulario no probo ser el dueño de nada
        // todavia. Sin actorUserId a proposito (mismo criterio que
        // employee_invited desde PR9): la cuenta objetivo ya queda
        // identificada via accountId, sin inventar una identidad de
        // actor que no existe.
        this.logAuthAudit(db, {
          tenantId: owner.tenantId,
          accountId: account.id,
          action: "password_reset_requested",
        });
      }

      return undefined;
    });
    this.emit("auth.changed", { action: "created" });
  }
  async resetPassword(token: string, newPasswordMock: string) {
    const result = this.store.mutate((db) => {
      const now = new Date();

      const challenge = db.passwordResetChallenges.find(
        (item) => item.token === token && !item.usedAt && !item.supersededAt,
      );
      if (!challenge) throw new Error("Invalid reset token");
      // Reject before any mutation: an expired challenge must not change the
      // password, touch account status/lockout, revoke sessions, consume the
      // challenge, or emit any audit event. expiresAt itself counts as
      // already expired (now >= expiresAt), same boundary as verifyEmail.
      if (now >= new Date(challenge.expiresAt)) {
        throw new Error("Invalid reset token");
      }

      const account = db.authAccounts.find((item) => item.userId === challenge.userId);
      if (!account) throw new Error("Account not found");

      // Recovery y activation/verification son máquinas de estado
      // SEPARADAS (ver PASSWORD_RECOVERY_ELIGIBLE_STATUSES en
      // auth-policy.ts). Aunque requestPasswordReset() ya filtra esto al
      // emitir el challenge, se revalida aquí también -- mismo principio
      // de "revalidar en cada paso, no solo al principio" que
      // activateEmployeeAccount desde PR9 (el estado pudo cambiar entre
      // la solicitud y el reset). Sin esto, resetPassword() podría
      // completar la activación de un empleado invitado sin que pase
      // por activateEmployeeAccount()/[/activar-cuenta/[token]] -- exactamente
      // el bypass que este ajuste cierra.
      if (!isPasswordRecoveryEligible(account.status)) {
        throw new Error("Invalid reset token");
      }

      // Mismo criterio que activateEmployeeAccount desde PR9: nunca un
      // fallback como "tenant-demo" si el User ya no existe -- se
      // rechaza, sin consumir el challenge ni tocar la cuenta. El caso
      // real es más acotado que en PR9 (acá no hay riesgo de reactivar
      // la cuenta equivocada, el AuthAccount ya identifica a quién se le
      // cambia la contraseña), pero la garantía debe ser la misma: nunca
      // inventar un tenant para un User que ya no existe.
      const user = db.users.find((item) => item.id === account.userId);
      if (!user) {
        throw new Error("Invalid reset token");
      }
      const tenantId = user.tenantId;
      const nowIso = now.toISOString();

      // Password policy en la capa funcional (mismo patrón que
      // activateEmployeeAccount desde PR9): una llamada directa a este
      // método no debe poder saltarse lo que el formulario ya exige.
      const passwordError =
        user.type === UserType.customer
          ? validateCustomerPassword(newPasswordMock, user.email)
          : validateEmployeePassword(newPasswordMock, user.email);
      if (passwordError) {
        throw new PasswordPolicyError(passwordError);
      }

      account.passwordHashMock = buildPasswordHashMock(newPasswordMock);
      account.passwordChangedAt = nowIso;
      account.updatedAt = nowIso;

      // R-A24: completing a reset always lifts a temporary lockout back
      // to active, resetting the failed-attempt counters. password_reset_required
      // is deliberately NOT handled here anymore -- isPasswordRecoveryEligible
      // above already rejected it before this point, so if we got here the
      // only non-active eligible status left is temporarily_locked.
      // disabled/archived were never eligible either way (R-A25: the
      // password changes, access doesn't -- and now recovery can't even
      // reach a disabled/archived account to begin with).
      if (account.status === AccountStatus.temporarily_locked) {
        account.status = AccountStatus.active;
        account.failedLoginAttempts = 0;
        account.lockedUntil = undefined;
      }

      // R-A24: revoke every existing (non-revoked) session for this user.
      const revokedSessions = db.sessions.filter(
        (session) => session.userId === account.userId && !session.revokedAt,
      );
      revokedSessions.forEach((session) => {
        session.revokedAt = nowIso;
      });

      challenge.usedAt = nowIso;

      // R-A30: session_revoked is an aggregate event emitted on every
      // successful reset, count included (0 when there was nothing to
      // revoke) — a missing log entry should never be the signal that no
      // sessions existed.
      this.logAuthAudit(db, {
        tenantId,
        actorUserId: account.userId,
        accountId: account.id,
        action: "session_revoked",
        metadata: { count: revokedSessions.length },
      });

      // R-A30: audit the completed reset.
      this.logAuthAudit(db, {
        tenantId,
        actorUserId: account.userId,
        accountId: account.id,
        action: "password_reset_completed",
      });

      // R-A24 ("notificación de cambio de contraseña"), antes pendiente
      // ("left for when the corresponding screen exists" -- ya existe).
      // Estrictamente limitado a esto: no hay canal real, preferencias,
      // ni lectura de notificaciones en este PR.
      db.notifications.push({
        id: this.id("notification"),
        tenantId,
        userId: account.userId,
        channel: NotificationChannel.in_app,
        type: "password_reset_completed",
        title: "Contraseña actualizada",
        message: "Tu contraseña fue actualizada correctamente.",
        status: NotificationStatus.unread,
        relatedEntityType: "AuthAccount",
        relatedEntityId: account.id,
        createdAt: nowIso,
      });

      return user.type === UserType.customer
        ? {
            userType: user.type,
            tenantSlug: db.tenants.find((tenant) => tenant.id === user.tenantId)?.slug,
          }
        : { userType: user.type };
    });
    this.emit("auth.changed", { action: "updated" });
    return result;
  }
  async verifyEmail(token: string) {
    const outcome = this.store.mutate((db) => {
      const verification = db.emailVerifications.find(
        (item) => item.token === token && !item.verifiedAt,
      );
      if (!verification) throw new Error("Invalid verification token");
      // Reject before any mutation: an expired token must not activate the
      // account, must not set verifiedAt, and must leave the account exactly
      // as it was (still pending_verification). expiresAt itself counts as
      // already expired (now >= expiresAt), not "valid until and including".
      if (new Date() >= new Date(verification.expiresAt)) {
        throw new Error("Invalid verification token");
      }
      verification.verifiedAt = this.now();
      const account = db.authAccounts.find((item) => item.userId === verification.userId);
      if (account) account.status = AccountStatus.active;

      const user = db.users.find((u) => u.id === verification.userId);
      const tenant = user ? db.tenants.find((t) => t.id === user.tenantId) : undefined;

      return { tenantSlug: tenant?.slug };
    });
    this.emit("auth.changed", { action: "updated" });
    return outcome;
  }
  /**
   * Boundary estrecho exclusivo de onboarding -- ver docstring en `AuthRepository.ts`. Crea el
   * AuthAccount YA `active` (nunca `password_reset_required`, a diferencia de `inviteEmployee`)
   * con la contraseña real elegida durante el alta. No se usa desde el flujo atómico real de
   * onboarding (`MockTenantOnboardingRepository` reproduce esta misma lógica DENTRO de su único
   * `store.transact()` para poder garantizar rollback real -- ver esa clase); existe igual como
   * capacidad mínima e independiente del boundary, verificable por separado.
   */
  async bootstrapEmployeeAccount(userId: string, passwordMock: string) {
    const account = this.store.mutate((db) => {
      const user = db.users.find((item) => item.id === userId);
      if (!user || user.type !== UserType.employee) {
        throw new Error("No se encontró un empleado con ese id.");
      }
      const passwordError = validateEmployeePassword(passwordMock, user.email);
      if (passwordError) {
        throw new PasswordPolicyError(passwordError);
      }
      if (db.authAccounts.some((item) => item.userId === userId)) {
        throw new Error("Este empleado ya tiene un AuthAccount.");
      }
      const now = this.now();
      const created = {
        id: this.id("auth"),
        userId,
        email: user.email,
        passwordHashMock: buildPasswordHashMock(passwordMock),
        status: AccountStatus.active,
        failedLoginAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.authAccounts.push(created);
      return created;
    });
    this.emit("auth.changed", { entityId: account.userId, action: "created" });
    return account;
  }
  async inviteEmployee(userId: string) {
    const result = this.store.mutate((db) => {
      const user = db.users.find((item) => item.id === userId);
      if (!user || user.type !== UserType.employee) {
        throw new Error("No se encontró un empleado con ese id.");
      }

      const now = this.now();
      let account = db.authAccounts.find((item) => item.userId === userId);

      if (!account) {
        account = {
          id: this.id("auth"),
          userId,
          email: user.email,
          // Inutilizable a propósito: nadie la conoce ni se expone en
          // ningún lado. La barrera real es el status de abajo.
          passwordHashMock: buildPasswordHashMock(this.id("employee-invite-placeholder")),
          status: AccountStatus.password_reset_required,
          failedLoginAttempts: 0,
          createdAt: now,
          updatedAt: now,
        };
        db.authAccounts.push(account);
      } else if (account.status === AccountStatus.active) {
        throw new Error("Este empleado ya tiene una cuenta activa.");
      } else if (account.status !== AccountStatus.password_reset_required) {
        throw new Error("No se puede invitar a este empleado en su estado actual.");
      } else {
        // Reinvitación: misma cuenta, nunca se duplica. La invitación
        // previa (si sigue vigente) queda huérfana pero válida hasta su
        // propio vencimiento -- mismo criterio que requestPasswordReset().
        account.updatedAt = now;
      }

      const invitation = {
        id: this.id("employee-invitation"),
        userId,
        // Capturado ahora, no re-derivado despues: es la referencia
        // autoritativa contra la que activateEmployeeAccount() revalida
        // el tenant al momento de activar (ver doc en la entidad).
        tenantId: user.tenantId,
        token: this.id("token"),
        createdAt: now,
        expiresAt: new Date(
          Date.now() + EMPLOYEE_INVITATION_TOKEN_HOURS * 60 * 60 * 1000,
        ).toISOString(),
      };
      db.employeeInvitations.push(invitation);

      // R-P04: toda accion sensible genera AuditLog. Invitar (o
      // reinvitar) a un empleado crea/reactiva credenciales de acceso --
      // sin esto, /administracion/auditoria no tendria ningun rastro de
      // quien recibio acceso y cuando.
      //
      // actorUserId queda SIN asignar a proposito: el llamador real es
      // un administrador, pero este método no recibe todavía identidad
      // de quién invita (no existe aún el service administrativo que la
      // proveería -- ver AuthRepository.inviteEmployee). Atribuir el
      // evento al propio empleado invitado (como se hacía antes) sería
      // falso -- el empleado no se invitó a sí mismo. Cuando exista esa
      // identidad, debe pasarse aquí; hasta entonces, mejor sin actor
      // que con uno incorrecto.
      this.logAuthAudit(db, {
        tenantId: user.tenantId,
        accountId: account.id,
        action: "employee_invited",
      });

      return { user, invitationToken: invitation.token };
    });
    this.emit("auth.changed", {
      entityId: result.user.id,
      tenantId: result.user.tenantId,
      action: "updated",
    });
    return result;
  }
  async activateEmployeeAccount(token: string, newPasswordMock: string) {
    this.store.mutate((db) => {
      const now = new Date();

      const invitation = db.employeeInvitations.find(
        (item) => item.token === token && !item.acceptedAt,
      );
      if (!invitation) throw new Error("Invalid activation token");
      // Mismo criterio que verifyEmail/resetPassword: expiresAt cuenta
      // como ya vencido, no "válido hasta e incluyendo".
      if (now >= new Date(invitation.expiresAt)) {
        throw new Error("Invalid activation token");
      }

      const account = db.authAccounts.find((item) => item.userId === invitation.userId);
      // Si otra invitación hermana ya activó esta cuenta, ya no está en
      // password_reset_required -- se rechaza igual que un token vencido,
      // sin distinguir el motivo hacia afuera.
      if (!account || account.status !== AccountStatus.password_reset_required) {
        throw new Error("Invalid activation token");
      }

      // Revalidacion de identidad al momento de activar -- el token y el
      // status de AuthAccount por si solos no bastan: entre la
      // invitacion y la activacion, User puede haber sido eliminado,
      // reconvertido a Customer, o reasignado a otro tenant. Ninguno de
      // esos casos se resuelve con un fallback como "tenant-demo": si no
      // hay una identidad Employee valida y en el MISMO tenant que se
      // capturo al invitar, la activacion se bloquea sin tocar nada (ni
      // consumir el token ni activar la cuenta) -- mismo mensaje generico
      // que un token vencido, sin revelar cual de las tres condiciones
      // fallo.
      const user = db.users.find((item) => item.id === account.userId);
      if (!user || user.type !== UserType.employee || user.tenantId !== invitation.tenantId) {
        throw new Error("Invalid activation token");
      }

      // Password policy en la capa funcional, no solo en el formulario:
      // una llamada directa a este metodo (sin pasar por
      // activateAccount.validation.ts) no debe poder activar una cuenta
      // con una contraseña que la politica rechazaria. Se valida ANTES
      // de mutar nada, junto con el resto de las condiciones de arriba.
      const passwordError = validateEmployeePassword(newPasswordMock, user.email);
      if (passwordError) {
        throw new PasswordPolicyError(passwordError);
      }

      const tenantId = user.tenantId;
      const nowIso = now.toISOString();

      account.passwordHashMock = buildPasswordHashMock(newPasswordMock);
      account.passwordChangedAt = nowIso;
      account.status = AccountStatus.active;
      account.failedLoginAttempts = 0;
      account.lockedUntil = undefined;
      account.updatedAt = nowIso;

      invitation.acceptedAt = nowIso;

      this.logAuthAudit(db, {
        tenantId,
        actorUserId: account.userId,
        accountId: account.id,
        action: "employee_activated",
      });

      return undefined;
    });
    this.emit("auth.changed", { action: "updated" });
  }
  async changePassword(input: Parameters<AuthRepository["changePassword"]>[0]) {
    this.store.mutate((db) => {
      const nowIso = this.now();

      const session = this.requireActiveSession(db, input.sessionId);

      const account = db.authAccounts.find((item) => item.userId === session.userId);
      if (!account) throw new Error("No se encontró la cuenta.");

      // A diferencia de login()/resetPassword() (donde revelar el motivo
      // exacto del fallo es un riesgo real de enumeración cross-account),
      // acá el usuario YA está autenticado como esta cuenta -- decirle que
      // su contraseña actual es incorrecta no filtra nada que no sepa ya.
      const currentMatches =
        account.passwordHashMock === buildPasswordHashMock(input.currentPasswordMock);
      if (!currentMatches) {
        throw new Error("La contraseña actual no es correcta.");
      }

      // PR13 (doc 4.13, "reautenticar con contraseña actual/MFA"): si la
      // cuenta tiene el segundo factor activo, cambiar la contraseña exige
      // AMBOS factores -- currentPasswordMock (ya validado arriba) Y un
      // código MFA/recovery code vigente. No reemplaza la verificación de
      // contraseña ya aprobada, se suma solo cuando aplica.
      const mfaEnrollment = db.mfaEnrollments.find(
        (item) => item.userId === account.userId && item.enabled,
      );
      if (mfaEnrollment) {
        const mfaCodeValid =
          Boolean(input.mfaCodeMock) &&
          this.consumeMfaCode(db, account.userId, input.mfaCodeMock as string);
        if (!mfaCodeValid) {
          throw new Error("El código de verificación en dos pasos no es correcto.");
        }
      }

      // Confirmado por QA manual (Andy, cuenta demo): sin este chequeo, la
      // pantalla permitía "cambiar" la contraseña por la misma que ya tenía
      // -- técnicamente no rompe nada del dominio, pero no tiene sentido de
      // producto dejarlo pasar como si fuera un cambio real. No está en el
      // documento de arquitectura; es una regla de UX razonable agregada a
      // pedido, igual que las demás políticas, en la capa funcional (no solo
      // en el formulario) para que una llamada directa no pueda saltársela.
      if (input.newPasswordMock === input.currentPasswordMock) {
        throw new Error("La nueva contraseña debe ser diferente a la actual.");
      }

      const user = db.users.find((item) => item.id === account.userId);
      if (!user) throw new Error("No se encontró el usuario.");
      const passwordError =
        user.type === UserType.customer
          ? validateCustomerPassword(input.newPasswordMock, user.email)
          : validateEmployeePassword(input.newPasswordMock, user.email);
      if (passwordError) throw new PasswordPolicyError(passwordError);
      const tenantId = user.tenantId;

      // Todo lo de arriba es validación de solo lectura (sesión, cuenta,
      // contraseña actual, política, usuario) -- ninguna mutación ocurre
      // hasta este punto. Igual que en resetPassword(): cualquier fallo
      // anterior deja passwordHashMock, sesiones, auditoría y notificación
      // exactamente como estaban, sin cambios parciales.
      account.passwordHashMock = buildPasswordHashMock(input.newPasswordMock);
      account.passwordChangedAt = nowIso;
      account.updatedAt = nowIso;

      // Revoca las sesiones RESTANTES -- todas menos input.sessionId.
      const revokedSessions = db.sessions.filter(
        (item) => item.userId === account.userId && item.id !== input.sessionId && !item.revokedAt,
      );
      revokedSessions.forEach((item) => {
        item.revokedAt = nowIso;
      });

      this.logAuthAudit(db, {
        tenantId,
        actorUserId: account.userId,
        accountId: account.id,
        action: "session_revoked",
        metadata: { count: revokedSessions.length },
      });
      this.logAuthAudit(db, {
        tenantId,
        actorUserId: account.userId,
        accountId: account.id,
        action: "password_changed",
      });

      db.notifications.push({
        id: this.id("notification"),
        tenantId,
        userId: account.userId,
        channel: NotificationChannel.in_app,
        type: "password_changed",
        title: "Contraseña actualizada",
        message: "Tu contraseña fue actualizada correctamente.",
        status: NotificationStatus.unread,
        relatedEntityType: "AuthAccount",
        relatedEntityId: account.id,
        createdAt: nowIso,
      });

      return undefined;
    });
    this.emit("auth.changed", { action: "updated" });
  }
  async getEmployeeAuthSummariesByUserIds(tenantId: string, userIds: readonly string[]) {
    return this.read((db) => {
      const uniqueIds = [...new Set(userIds)];
      const summaries: Array<{
        userId: string;
        status: AccountStatus;
        mfaEnabled: boolean;
        lastLoginAt?: string;
      }> = [];
      for (const userId of uniqueIds) {
        // Mismo criterio que el resto de las lecturas administrativas tenant-scoped
        // (RoleRepository.getByIdScoped, BranchRepository.getByIdScoped): el tenant se valida
        // ANTES de resolver nada más. Un userId de otro tenant, inexistente, o sin AuthAccount
        // todavía simplemente no aparece en el resultado -- las tres causas se ven igual desde
        // afuera.
        const user = db.users.find((item) => item.id === userId && item.tenantId === tenantId);
        if (!user) continue;
        const account = db.authAccounts.find((item) => item.userId === userId);
        if (!account) continue;
        const enrollment = db.mfaEnrollments.find((item) => item.userId === userId);
        summaries.push({
          userId,
          status: account.status,
          mfaEnabled: Boolean(enrollment?.enabled),
          lastLoginAt: account.lastLoginAt,
        });
      }
      return summaries;
    });
  }
  async revokeAllSessionsByUserId(tenantId: string, userId: string) {
    this.store.mutate((db) => {
      const user = db.users.find((item) => item.id === userId && item.tenantId === tenantId);
      // Cross-tenant o userId inexistente: no revoca nada, no distingue el motivo (mismo
      // criterio que el resto del contrato) -- pero tampoco lanza, porque es idempotente por
      // diseño: revocar "de nuevo" nunca debe ser un error para el caller.
      if (!user) return undefined;

      const nowIso = this.now();
      const activeSessions = db.sessions.filter(
        (item) => item.userId === userId && !item.revokedAt,
      );
      activeSessions.forEach((item) => {
        item.revokedAt = nowIso;
      });
      return undefined;
    });
    // No se audita acá con this.logAuthAudit: este método no recibe la identidad del actor
    // administrativo que dispara la revocación (mismo tipo de límite ya documentado en
    // inviteEmployee -- ver su docstring), así que auditarlo acá misatribuiría la acción. El
    // caller administrativo (administration) SÍ conoce al actor real y deja su propia entrada de
    // auditoría (`employee.status_changed`/`employee.role_changed`/etc.) con una nota de que
    // también revocó sesiones -- ese es el registro atribuible correctamente.
    this.emit("auth.changed", { entityId: userId, action: "updated" });
  }
  private logAuthAudit(
    db: MockDatabase,
    entry: {
      tenantId: string;
      actorUserId?: string;
      accountId?: string;
      action: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    db.auditLogs.push({
      id: this.id("audit"),
      tenantId: entry.tenantId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: "AuthAccount",
      entityId: entry.accountId,
      metadata: entry.metadata,
      createdAt: this.now(),
    });
  }
  private isValidOperationalUser(db: MockDatabase, userId: string): boolean {
    const user = db.users.find((item) => item.id === userId);
    if (!user || user.type !== UserType.employee || user.status !== UserStatus.active) return false;
    const tenant = db.tenants.find((item) => item.id === user.tenantId);
    if (!tenant || tenant.status !== TenantStatus.active) return false;
    const role = user.roleId ? db.roles.find((item) => item.id === user.roleId) : null;
    return Boolean(role && role.tenantId === user.tenantId && role.status === RoleStatus.active);
  }

  /**
   * Si el lockout ya vencio (lockedUntil <= now), restaura la cuenta a
   * estado operable ANTES de evaluar credenciales. Unica fuente de verdad
   * para "sigue bloqueada la cuenta" -- compartida por login() y
   * verifyMfaChallenge() (hardening post-auditoria del PR14) para que
   * ninguna de las dos rutas pueda desincronizarse de la otra.
   */
  private applyAutoUnlockIfExpired(account: AuthAccount, now: Date): void {
    if (
      account.status === AccountStatus.temporarily_locked &&
      account.lockedUntil &&
      new Date(account.lockedUntil) <= now
    ) {
      account.status = AccountStatus.active;
      account.failedLoginAttempts = 0;
      account.lockedUntil = undefined;
    }
  }
  /**
   * Contabiliza un fallo de autenticacion -- password incorrecta (login())
   * O codigo MFA incorrecto (verifyMfaChallenge()), PR14 seccion 2:
   * comparten el MISMO contador/ventana/escalada de LOGIN_ATTEMPT_RULES.
   * Antes, un fallo de codigo MFA solo incrementaba
   * MfaChallenge.failedAttempts (un contador separado, por diseño
   * explicito de PR13) -- eso permitia reiniciar login() indefinidamente
   * para conseguir una ventana nueva de intentos contra el codigo sin que
   * la cuenta se bloqueara nunca, porque failedLoginAttempts nunca se
   * enteraba de esos fallos. `failureAction` mantiene el nombre de evento
   * de auditoria correcto para cada canal (login_failed vs mfa_failed,
   * R-A30 exige ambos) sin duplicar la logica de ventana/escalada.
   */
  private registerFailedAuthAttempt(
    db: MockDatabase,
    account: AuthAccount,
    tenantId: string,
    failureAction: "login_failed" | "mfa_failed",
  ): void {
    const now = new Date();
    const windowMs = FAILED_ATTEMPTS_WINDOW_MINUTES * 60 * 1000;
    const lockoutLookbackMs = LOCKOUT_ESCALATION_LOOKBACK_HOURS * 60 * 60 * 1000;
    const escalationResetMs = LOCKOUT_RESET_AFTER_MINUTES * 60 * 1000;

    const isCountableFailure = (log: { action: string }) =>
      log.action === "login_failed" ||
      log.action === "mfa_failed" ||
      log.action === "account_locked";

    // A successful login always cuts the failure streak, regardless of
    // how recent it was: only failure/lockout events that happened
    // *after* the most recent login_success — and still within the
    // active window (doc 4.7) — count toward the current attempt number.
    // Older ones (before the window, or before the last success) don't
    // carry over. Derived from auditLogs instead of a stored counter, so
    // it self-resets with time automatically.
    const lastSuccessAt = db.auditLogs
      .filter(
        (log) =>
          log.entityType === "AuthAccount" &&
          log.entityId === account.id &&
          log.tenantId === tenantId &&
          log.action === "login_success",
      )
      .reduce((latest, log) => Math.max(latest, new Date(log.createdAt).getTime()), 0);

    const recentFailureLogs = db.auditLogs.filter(
      (log) =>
        log.entityType === "AuthAccount" &&
        log.entityId === account.id &&
        log.tenantId === tenantId &&
        isCountableFailure(log) &&
        new Date(log.createdAt).getTime() > lastSuccessAt &&
        now.getTime() - new Date(log.createdAt).getTime() < windowMs,
    );
    const currentAttemptNumber = recentFailureLogs.length + 1;
    // When this current streak started (the earliest failure still inside
    // the window), or "now" if this is the first failure of a new streak.
    // Used below to tell the escalation-reset gap apart from the normal
    // few-seconds-to-minutes spacing between attempts within one streak.
    const streakStartAt =
      recentFailureLogs.length > 0
        ? Math.min(...recentFailureLogs.map((log) => new Date(log.createdAt).getTime()))
        : now.getTime();

    const rule =
      LOGIN_ATTEMPT_RULES.find((item) => item.attemptNumber === currentAttemptNumber) ??
      LOGIN_ATTEMPT_RULES[LOGIN_ATTEMPT_RULES.length - 1];

    // Kept for display/inspection purposes; the lockout decision above
    // uses the windowed count, not this field.
    account.failedLoginAttempts = currentAttemptNumber;

    if (rule.triggersLockout) {
      // Escalation (15/30/60 min) resets once LOCKOUT_RESET_AFTER_MINUTES
      // pass without a new failure/lockout on this account — the next
      // lockout after such a quiet period counts as a first occurrence
      // again, independent of the login_success-based streak reset above.
      //
      // The gap is measured from the start of the CURRENT streak
      // (streakStartAt), not from "now" — attempts within the same
      // streak are only seconds/minutes apart by design (that's the
      // failed-attempts window), so comparing against the most recent
      // one would never detect a quiet period once a new streak is
      // already a few attempts in.
      const priorFailureOrLockoutTimestamps = db.auditLogs
        .filter(
          (log) =>
            log.entityType === "AuthAccount" &&
            log.entityId === account.id &&
            log.tenantId === tenantId &&
            isCountableFailure(log) &&
            new Date(log.createdAt).getTime() < streakStartAt,
        )
        .map((log) => new Date(log.createdAt).getTime());
      const lastFailureOrLockoutAt =
        priorFailureOrLockoutTimestamps.length > 0
          ? Math.max(...priorFailureOrLockoutTimestamps)
          : null;
      const escalationHasReset =
        lastFailureOrLockoutAt !== null &&
        streakStartAt - lastFailureOrLockoutAt > escalationResetMs;

      const recentLockouts = escalationHasReset
        ? 0
        : db.auditLogs.filter(
            (log) =>
              log.entityType === "AuthAccount" &&
              log.entityId === account.id &&
              log.tenantId === tenantId &&
              log.action === "account_locked" &&
              now.getTime() - new Date(log.createdAt).getTime() < lockoutLookbackMs,
          ).length;
      account.status = AccountStatus.temporarily_locked;
      account.lockedUntil = new Date(
        now.getTime() + getLockoutMinutesForOccurrence(recentLockouts + 1) * 60 * 1000,
      ).toISOString();
      this.logAuthAudit(db, {
        tenantId,
        actorUserId: account.userId,
        accountId: account.id,
        action: "account_locked",
      });
      // No existia ninguna notificacion para este evento -- solo
      // quedaba en auditLogs, invisible para el dueño de la cuenta.
      // Mismo patron que password_changed/password_reset_completed:
      // in-app, dirigida al propio usuario de la cuenta bloqueada
      // (sirve igual para Customer que para Employee/Admin).
      db.notifications.push({
        id: this.id("notification"),
        tenantId,
        userId: account.userId,
        channel: NotificationChannel.in_app,
        type: "account_locked",
        title: "Cuenta bloqueada temporalmente",
        message: "Se bloqueó tu cuenta por varios intentos fallidos de inicio de sesión.",
        status: NotificationStatus.unread,
        relatedEntityType: "AuthAccount",
        relatedEntityId: account.id,
        createdAt: now.toISOString(),
      });
    } else {
      this.logAuthAudit(db, {
        tenantId,
        actorUserId: account.userId,
        accountId: account.id,
        action: failureAction,
      });
    }

    account.updatedAt = now.toISOString();
  }
  /**
   * Valida que exista una sesión activa y no revocada para sessionId --
   * mismo chequeo que changePassword() ya hacía inline, extraído (PR13)
   * porque beginMfaEnrollment/verifyMfaEnrollment/disableMfa lo necesitan
   * también, palabra por palabra.
   */
  private requireActiveSession(db: MockDatabase, sessionId: string): Session {
    const session = db.sessions.find((item) => item.id === sessionId && !item.revokedAt);
    if (!session || new Date() >= new Date(session.expiresAt)) {
      throw new Error("Tu sesión ya no es válida. Vuelve a iniciar sesión.");
    }
    return session;
  }
  /**
   * Crea el MfaChallenge efímero que login() devuelve en vez de una
   * Session cuando la cuenta tiene MFA habilitado (R-A16).
   */
  private createMfaChallenge(
    db: MockDatabase,
    enrollment: MfaEnrollment,
    opts: { rememberMe: boolean; deviceLabel?: string },
  ): MfaChallenge {
    const challenge: MfaChallenge = {
      id: this.id("mfa-challenge"),
      userId: enrollment.userId,
      method: enrollment.method,
      failedAttempts: 0,
      createdAt: this.now(),
      expiresAt: new Date(Date.now() + MFA_CHALLENGE_EXPIRATION_MINUTES * 60 * 1000).toISOString(),
      rememberMe: opts.rememberMe,
      deviceLabel: opts.deviceLabel,
    };
    db.mfaChallenges.push(challenge);
    return challenge;
  }
  /**
   * Verifica codeMock contra el código MFA vigente del usuario
   * (MfaEnrollment.demoCodeMock, fase dummy no rotativo) O contra un
   * RecoveryCode propio sin usar -- si es un recovery code, lo consume
   * (used=true) como efecto secundario. Compartido por
   * verifyMfaChallenge() y changePassword(): una sola fuente de verdad
   * para "qué cuenta como un código MFA válido para este usuario", en vez
   * de duplicar la comparación en cada llamador.
   */
  private consumeMfaCode(db: MockDatabase, userId: string, codeMock: string): boolean {
    const enrollment = db.mfaEnrollments.find((item) => item.userId === userId && item.enabled);
    if (enrollment && enrollment.demoCodeMock === codeMock) {
      return true;
    }
    const recoveryCode = db.recoveryCodes.find(
      (item) => item.userId === userId && !item.used && item.code === codeMock,
    );
    if (recoveryCode) {
      recoveryCode.used = true;
      return true;
    }
    return false;
  }
  /**
   * Código MFA de demostración: MFA_CODE_DIGITS dígitos numéricos, con
   * ceros a la izquierda si hace falta (mismo largo siempre, como un TOTP
   * real).
   */
  private generateMfaCodeMock(): string {
    const max = 10 ** MFA_CODE_DIGITS;
    const value = Math.floor(Math.random() * max);
    return String(value).padStart(MFA_CODE_DIGITS, "0");
  }
  /**
   * Formato legible tipo "XXXX-XXXX" (hex mayúsculas) -- ni tan corto que
   * colisione fácil, ni tan largo que sea incómodo de transcribir a mano
   * si el usuario decide guardarlo en papel.
   */
  private generateRecoveryCode(): string {
    const part = () => crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
    return `${part()}-${part()}`;
  }
}
