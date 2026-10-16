import { PasswordPolicyError } from "@/config/auth-policy";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import type { MfaMethod, Session } from "@/core/entities";
import { AccountStatus, UserType } from "@/core/enums";
import {
  type AuthRepository,
  type BeginMfaEnrollmentResult,
  type ChangePasswordInput,
  type EmployeeAuthSummary,
  type GoogleLoginInput,
  type InviteEmployeeResult,
  type LoginInput,
  type LoginResult,
  MfaChallengeUnavailableError,
  type RegisterCustomerInput,
  type RegisterCustomerResult,
  type RequestPasswordResetInput,
  type ResendEmailVerificationInput,
  type ResetPasswordResult,
} from "@/core/repositories/AuthRepository";
import type { TenantRepository } from "@/core/repositories";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { ApiCurrentSession } from "@/infrastructure/api/apiCurrentSession";
import { toSession } from "@/infrastructure/api/apiSessionMapper";
import { type ApiUser, toUser } from "@/infrastructure/api/apiUserMapper";
import { backendFetch } from "@/infrastructure/api/backendClient";
import type { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";

const NOT_AVAILABLE = "Esta función aún no está disponible en modo API.";
const GENERIC_LOGIN_ERROR = "No fue posible iniciar sesión. Verifica tus credenciales o intenta más tarde.";
const GENERIC_REGISTER_ERROR = "No se pudo completar el registro.";
const INVALID_LINK_ERROR = "Este enlace no es válido o ya expiró.";
const INVALID_ACTIVATION_LINK = "Este enlace de activación no es válido o ya expiró.";
const GENERIC_BRANCH_ERROR = "No se pudo cambiar la sucursal activa.";
const GENERIC_CHANGE_PASSWORD_ERROR = "No se pudo cambiar la contraseña. Inténtalo nuevamente.";
const GOOGLE_LOGIN_UNAVAILABLE = "Inicio de sesión con Google no disponible.";
const GENERIC_MFA_CODE_ERROR = "El código no es correcto. Inténtalo de nuevo.";
const GENERIC_MFA_ERROR = "No se pudo completar la verificación en dos pasos. Inténtalo nuevamente.";

/** Respuesta de `/api/auth/login` cuando la cuenta tiene MFA activo (sin cookie todavia). */
interface ApiMfaRequired {
  status: "mfa_required";
  challengeId: string;
  method: MfaMethod;
}

interface ApiInviteEmployeeResult {
  userId: string;
  invitationToken: string;
  expiresAt: string;
}

interface ApiEmployeeAuthSummary {
  userId: string;
  /** null cuando el empleado todavia no tiene AuthAccount. */
  status: string | null;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
  fields?: { newPassword?: string; password?: string };
}

const ACCOUNT_STATUSES: ReadonlySet<string> = new Set(Object.values(AccountStatus));

function isAccountStatus(value: string | null): value is AccountStatus {
  return value !== null && ACCOUNT_STATUSES.has(value);
}

function notAvailable(): never {
  throw new Error(NOT_AVAILABLE);
}

async function readApiError(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

/** Mensaje del ApiError reenviado por el Route Handler (ya generico en el backend). */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body.message === "string" && body.message ? body.message : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Error equivalente al del mock a partir de un ApiError del backend: un 400 con `fields` de
 * contraseña es PasswordPolicyError (la UI lo muestra tal cual); otro campo invalido usa su propio
 * mensaje; el resto usa `message`.
 */
async function toError(response: Response, fallback: string): Promise<Error> {
  let body: { message?: unknown; fields?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Sin cuerpo JSON (p. ej. un 5xx del proxy): se usa el mensaje por defecto.
  }
  if (response.status === 400 && body.fields && typeof body.fields === "object") {
    const fields = body.fields as Record<string, unknown>;
    const passwordMessage = fields.password ?? fields.newPassword;
    if (typeof passwordMessage === "string" && passwordMessage) return new PasswordPolicyError(passwordMessage);
    const firstMessage = Object.values(fields).find((value) => typeof value === "string" && value);
    if (typeof firstMessage === "string") return new Error(firstMessage);
  }
  return new Error(typeof body.message === "string" && body.message ? body.message : fallback);
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * AuthRepository de modo api. Solo habla con los Route Handlers same-origin `/api/auth/*`; el JWT
 * queda en la cookie HttpOnly y este repositorio nunca lo ve.
 *
 * Soportados en modo api: login, logout, sesion actual, registro de clientes, verificacion de
 * correo, recuperacion de contraseña, activacion e invitacion de empleados, y cambio de contraseña
 * de la sesion actual. Ninguno de los flujos de cuenta crea sesion: el token de un solo uso viaja
 * solo por correo.
 *
 * Los metodos que el backend todavia no soporta (MFA...) lanzan un error explicito: no se simulan.
 */
export class ApiAuthRepository implements AuthRepository {
  /** tenantId real de la tienda publica configurada; se consulta una sola vez (ver resolveTenantSlug). */
  private publicStorefrontTenantId: Promise<string | null> | null = null;

  constructor(
    private readonly currentSession: CurrentSessionClient,
    /** Repositorio de tenants (mock) solo para traducir tenantId -> slug (login y recuperacion). */
    private readonly tenants: TenantRepository,
    private readonly eventBus: DataEventBus,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        password: input.passwordMock,
        rememberMe: input.rememberMe,
        deviceLabel: input.deviceLabel,
        tenantSlug: await this.resolveTenantSlug(input.tenantId),
        // Solo indica el acceso usado; el Route Handler lo compara con el tipo real de /auth/me
        // antes de crear la cookie y responde el error generico si no coincide.
        expectedUserType: input.expectedUserType,
      }),
    });
    if (!response.ok) throw new Error(await errorMessage(response, GENERIC_LOGIN_ERROR));

    return this.toLoginResult((await response.json()) as ApiCurrentSession | ApiMfaRequired);
  }

  /**
   * "Continuar con Google": solo clientes (`expectedUserType` fijo en `customer`). El ID token solo
   * pasa por memoria hacia el Route Handler; nunca se guarda ni se registra. Un 503 (Google no
   * configurado o backend caido) muestra "no disponible"; cualquier otro error, el mensaje generico
   * del login.
   */
  async loginWithGoogle(input: GoogleLoginInput): Promise<LoginResult> {
    const response = await postJson("/api/auth/google", {
      idToken: input.idToken,
      tenantSlug: input.tenantSlug,
      expectedUserType: UserType.customer,
      rememberMe: input.rememberMe,
      deviceLabel: input.deviceLabel,
    });
    if (response.status === 503) throw new Error(GOOGLE_LOGIN_UNAVAILABLE);
    if (!response.ok) throw new Error(await errorMessage(response, GENERIC_LOGIN_ERROR));
    return this.toLoginResult((await response.json()) as ApiCurrentSession | ApiMfaRequired);
  }

  /**
   * Segundo paso del login. Un codigo incorrecto deja el desafio vivo (Error con el mensaje del
   * backend); un desafio vencido o agotado lanza MfaChallengeUnavailableError (volver al paso 1).
   * Ambos llegan como 401: se distinguen por `code`.
   */
  async verifyMfaChallenge(challengeId: string, codeMock: string): Promise<Session> {
    const response = await postJson("/api/auth/mfa/verify", { challengeToken: challengeId, code: codeMock });
    if (!response.ok) {
      const body = await readApiError(response);
      if (body?.code === "MFA_CHALLENGE_UNAVAILABLE") {
        throw new MfaChallengeUnavailableError(body.message || undefined);
      }
      throw new Error(body?.message || GENERIC_MFA_CODE_ERROR);
    }
    return this.startSession((await response.json()) as ApiCurrentSession);
  }

  async logout(sessionId: string): Promise<void> {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("No se pudo cerrar la sesion.");
    } finally {
      this.forgetLocalState();
      this.eventBus.emit("auth.changed", { entityId: sessionId, action: "updated" });
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const current = await this.currentSession.get();
    if (!current || current.session.id !== sessionId) return null;
    return toSession(current);
  }

  async getCurrentSessionId(): Promise<string | null> {
    return (await this.currentSession.get())?.session.id ?? null;
  }

  /**
   * Guarda la sucursal activa en la sesion del backend (que valida que este permitida). La
   * respuesta tiene la forma de /auth/me: se usa como sesion cacheada, asi `getSession` devuelve
   * ya la sucursal persistida sin otra llamada.
   */
  async setActiveBranchId(branchId: string): Promise<void> {
    const response = await fetch("/api/auth/session/branch", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId }),
    });
    if (!response.ok) throw new Error(await errorMessage(response, GENERIC_BRANCH_ERROR));
    this.currentSession.prime((await response.json()) as ApiCurrentSession);
  }

  /**
   * Garantia de ultimo recurso del contrato: nunca lanza. La cookie es HttpOnly, asi que solo el
   * Route Handler de logout puede borrarla.
   */
  async clearLocalSession(): Promise<void> {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      // Sin red la cookie no se puede borrar desde aqui; /api/auth/me la borra al recibir 401.
    }
    this.forgetLocalState();
    this.eventBus.emit("auth.changed", { action: "updated" });
  }

  async registerCustomer(input: RegisterCustomerInput): Promise<RegisterCustomerResult> {
    const response = await postJson("/api/auth/register", {
      tenantSlug: input.tenantSlug,
      name: input.name,
      email: input.email,
      phone: input.phone,
      password: input.passwordMock,
    });
    if (!response.ok) throw await toError(response, GENERIC_REGISTER_ERROR);

    // El backend responde el mismo 202 sea el correo nuevo o ya registrado, sin id: no se lee su
    // cuerpo. El resumen sale de lo que escribio el usuario y la UI muestra el mensaje generico.
    return {
      user: { name: input.name, email: input.email, type: UserType.customer },
      // En modo api el enlace de verificacion llega solo por correo.
      emailVerificationToken: null,
    };
  }

  /**
   * Nunca lanza (mismo criterio que requestPasswordReset): la UI muestra el mismo mensaje generico
   * pase lo que pase, incluidos un 400, un 429 o un backend caido.
   */
  async resendEmailVerification(input: ResendEmailVerificationInput): Promise<void> {
    try {
      await postJson("/api/auth/email/resend", {
        email: input.email.trim().toLowerCase(),
        tenantSlug: input.tenantSlug,
      });
    } catch {
      // Sin red: misma respuesta generica.
    }
  }

  async verifyEmail(token: string): Promise<{ tenantSlug?: string }> {
    const response = await postJson("/api/auth/verify-email", { token });
    if (!response.ok) throw await toError(response, INVALID_LINK_ERROR);
    const { tenantSlug } = (await response.json()) as { tenantSlug?: string | null };
    return { tenantSlug: tenantSlug ?? undefined };
  }

  /**
   * Igual que el contrato del mock: nunca lanza (R-A19). La UI muestra la misma respuesta generica
   * pase lo que pase, incluidos un correo con formato invalido o un backend caido.
   */
  async requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
    try {
      await postJson("/api/auth/password/forgot", {
        email: input.email,
        tenantSlug: await this.resolveTenantSlug(input.tenantId),
      });
    } catch {
      // Sin red: misma respuesta generica.
    }
  }

  async resetPassword(token: string, newPasswordMock: string): Promise<ResetPasswordResult> {
    const response = await postJson("/api/auth/password/reset", { token, newPassword: newPasswordMock });
    if (!response.ok) throw await toError(response, INVALID_LINK_ERROR);
    const result = (await response.json()) as { userType: string; tenantSlug?: string | null };
    return { userType: result.userType as UserType, tenantSlug: result.tenantSlug ?? undefined };
  }

  /**
   * Reenvia el codigo por correo del segundo paso del login. Un desafio vencido o reemplazado lanza
   * MfaChallengeUnavailableError; el limite de envios (429) y el metodo app (400) usan el mensaje del
   * backend.
   */
  async resendMfaChallengeCode(challengeId: string): Promise<{ demoCodeMock?: string }> {
    const response = await postJson("/api/auth/mfa/resend", { challengeToken: challengeId });
    if (!response.ok) {
      const body = await readApiError(response);
      if (body?.code === "MFA_CHALLENGE_UNAVAILABLE") {
        throw new MfaChallengeUnavailableError(body.message || undefined);
      }
      throw new Error(body?.message || GENERIC_MFA_ERROR);
    }
    return {};
  }

  /**
   * TOTP: devuelve el secreto y el `otpauthUri` para el QR (se genera en el navegador); ninguno de
   * los dos se guarda ni se registra. Correo: el backend envia el codigo y responde `secret` y
   * `otpauthUri` en null; repetirlo reenvia el codigo. La sesion sale de la cookie: `sessionId` no se
   * envia.
   */
  async beginMfaEnrollment(_sessionId: string, method: MfaMethod): Promise<BeginMfaEnrollmentResult> {
    const response = await postJson("/api/auth/mfa/enrollment", { method });
    if (!response.ok) throw await toError(response, GENERIC_MFA_ERROR);
    const { secret, otpauthUri } = (await response.json()) as {
      secret: string | null;
      otpauthUri: string | null;
    };
    return { secret: secret ?? undefined, otpauthUri: otpauthUri ?? undefined };
  }

  /** Los codigos de recuperacion se devuelven una sola vez y no se guardan en ningun lado. */
  async verifyMfaEnrollment(_sessionId: string, codeMock: string): Promise<{ recoveryCodes: string[] }> {
    const response = await postJson("/api/auth/mfa/enrollment/verify", { code: codeMock });
    if (!response.ok) throw await toError(response, GENERIC_MFA_ERROR);
    const { recoveryCodes } = (await response.json()) as { recoveryCodes: string[] };
    // "mfa.changed", no "auth.changed": igual que el mock (ver DataEventName).
    this.eventBus.emit("mfa.changed", { action: "updated" });
    return { recoveryCodes };
  }

  /** `fields.currentPassword` llega como Error con su mensaje (ver `toError`). */
  async disableMfa(_sessionId: string, currentPasswordMock: string): Promise<void> {
    const response = await postJson("/api/auth/mfa/disable", { currentPassword: currentPasswordMock });
    if (!response.ok) throw await toError(response, GENERIC_MFA_ERROR);
    this.eventBus.emit("mfa.changed", { action: "updated" });
  }

  /** Codigo por correo para el cambio de contraseña (solo con el MFA por correo activo). */
  async requestMfaActionCode(): Promise<{ demoCodeMock?: string }> {
    const response = await fetch("/api/auth/mfa/code", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw await toError(response, GENERIC_MFA_ERROR);
    return {};
  }

  /** `null` si el usuario nunca inicio una activacion (el backend responde `method: null`). */
  async getMfaStatus(): Promise<{ enabled: boolean; method: MfaMethod } | null> {
    const response = await fetch("/api/auth/mfa", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw await toError(response, GENERIC_MFA_ERROR);
    const status = (await response.json()) as { enabled: boolean; method: MfaMethod | null };
    return status.method ? { enabled: status.enabled, method: status.method } : null;
  }
  bootstrapEmployeeAccount(): ReturnType<AuthRepository["bootstrapEmployeeAccount"]> {
    return notAvailable();
  }

  /** Invita o reinvita al empleado y devuelve el User actualizado junto al token de invitacion. */
  async inviteEmployee(userId: string): Promise<InviteEmployeeResult> {
    const inviteResult = await backendFetch<ApiInviteEmployeeResult>(`/administration/users/${userId}/invite`, {
      method: "POST",
    });
    const user = toUser(await backendFetch<ApiUser>(`/administration/users/${userId}`));
    this.eventBus.emit("auth.changed", { entityId: userId, action: "updated" });
    return { user, invitationToken: inviteResult.invitationToken };
  }

  /**
   * Endpoint publico: va por el Route Handler `/api/auth/activate-employee` (el puente bloquea
   * `/auth/**`). Un error de politica de contraseña llega en `fields.newPassword`; cualquier otro
   * 4xx/5xx se reporta con el mensaje generico de enlace invalido.
   */
  async activateEmployeeAccount(token: string, newPasswordMock: string): Promise<void> {
    const response = await fetch("/api/auth/activate-employee", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: newPasswordMock }),
    });
    if (response.ok) return;

    const errorData = await readApiError(response);
    if (errorData?.fields?.newPassword) throw new PasswordPolicyError(errorData.fields.newPassword);
    throw new Error(errorData?.message || INVALID_ACTIVATION_LINK);
  }

  /**
   * La cuenta sale del JWT de la cookie: `sessionId` no se envia. `mfaCode` (app o recuperacion)
   * solo viaja si viene: el backend lo exige cuando el MFA esta activo. `fields.newPassword`
   * (politica o igual a la actual) llega como PasswordPolicyError; `fields.currentPassword` y
   * `fields.mfaCode` como Error con su mensaje (ver `toError`).
   */
  async changePassword(input: ChangePasswordInput): Promise<void> {
    const mfaCode = input.mfaCodeMock?.trim();
    const response = await postJson("/api/auth/password/change", {
      currentPassword: input.currentPasswordMock,
      newPassword: input.newPasswordMock,
      ...(mfaCode ? { mfaCode } : {}),
    });
    if (!response.ok) throw await toError(response, GENERIC_CHANGE_PASSWORD_ERROR);
  }

  /**
   * Los empleados sin AuthAccount (`status: null`) o con un estado desconocido se omiten, igual que
   * en el contrato: no aparecen en el resultado.
   */
  async getEmployeeAuthSummariesByUserIds(
    _tenantId: string,
    userIds: readonly string[],
  ): Promise<EmployeeAuthSummary[]> {
    if (userIds.length === 0) return [];
    const summaries = await backendFetch<ApiEmployeeAuthSummary[]>("/administration/users/auth-summaries", {
      method: "POST",
      body: { userIds: Array.from(new Set(userIds)) },
    });
    return summaries.flatMap((summary) =>
      isAccountStatus(summary.status)
        ? [
            {
              userId: summary.userId,
              status: summary.status,
              mfaEnabled: summary.mfaEnabled,
              lastLoginAt: summary.lastLoginAt ?? undefined,
            },
          ]
        : [],
    );
  }

  /**
   * En modo api el backend revoca las sesiones por si mismo al cambiar estado, rol o sucursales
   * (UserService -> SessionRevoker), asi que no hay nada que hacer desde el cliente. El contrato es
   * idempotente: resolver sin error evita abortar una edicion que ya se confirmo en el servidor.
   */
  async revokeAllSessionsByUserId(): Promise<void> {
    // Sin accion: el backend ya revoca las sesiones (ver comentario superior).
  }

  /**
   * El backend identifica la tienda por slug. Se traduce el tenantId que ya resolvio el storefront
   * publico al slug de ESA tienda; si no se puede, no se envia y el backend responde el error
   * generico para cuentas de cliente.
   *
   * En modo api PublicTenantProvider entrega el tenantId real del backend (UUID), que no existe en
   * el mock: en ese caso solo se acepta si es el de la tienda publica configurada. Nunca se adivina.
   */
  private async resolveTenantSlug(tenantId: string | undefined): Promise<string | undefined> {
    if (!tenantId) return undefined;
    try {
      const mockSlug = (await this.tenants.getById(tenantId))?.slug;
      if (mockSlug) return mockSlug;
    } catch {
      // Se intenta con la tienda publica configurada.
    }
    return (await this.getPublicStorefrontTenantId()) === tenantId ? publicStorefrontSlug : undefined;
  }

  /**
   * Mismo endpoint publico que usa el storefront (`/public/{slug}/config`), leido aqui para que
   * infraestructura no dependa del modulo storefront. Un fallo no se cachea: se reintenta despues.
   */
  private getPublicStorefrontTenantId(): Promise<string | null> {
    if (!this.publicStorefrontTenantId) {
      this.publicStorefrontTenantId = backendFetch<{ tenantId?: unknown }>(
        `/public/${encodeURIComponent(publicStorefrontSlug)}/config`,
      )
        .then((config) => (typeof config.tenantId === "string" ? config.tenantId : null))
        .catch(() => {
          this.publicStorefrontTenantId = null;
          return null;
        });
    }
    return this.publicStorefrontTenantId;
  }

  /** Con MFA activo aun no hay sesion: el mismo formulario pide el codigo. */
  private toLoginResult(body: ApiCurrentSession | ApiMfaRequired): LoginResult {
    if ("status" in body && body.status === "mfa_required") {
      return { status: "mfa_required", challengeId: body.challengeId, method: body.method };
    }
    return { status: "authenticated", session: this.startSession(body as ApiCurrentSession) };
  }

  /** Sesion recien creada (login sin MFA o segundo paso): se usa como cache y se avisa a la app. */
  private startSession(current: ApiCurrentSession): Session {
    this.currentSession.prime(current);
    this.eventBus.emit("auth.changed", { entityId: current.session.id, action: "created" });
    return toSession(current);
  }

  private forgetLocalState(): void {
    this.currentSession.invalidate();
  }
}
