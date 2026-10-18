/**
 * Centralized authentication security policy.
 *
 * Source: Arquitectura_Frontend_SaaS.pdf — sections 4.5 (password policy)
 * and 4.7 (failed login attempts / progressive lockout).
 *
 * This is the canonical source for password/lockout related values.
 * `authPolicy` at the bottom (consumed today by MockAuthRepository)
 * derives its values from here instead of repeating them, so there is
 * a single place to change a rule.
 *
 * Customer y Employee comparten las mismas reglas estructurales; Employee usa un mínimo mayor
 * porque incluye al Tenant Admin privilegiado. Toda nueva contraseña se valida aquí; login no
 * revalida política para conservar acceso a credenciales legacy válidas.
 */

import { AccountStatus } from "@/core/enums";

export interface PasswordPolicy {
  readonly MIN_LENGTH: number;
  readonly MAX_LENGTH: number;
  readonly ALLOW_UNICODE: boolean;
  readonly ALLOW_SPACES: boolean;
  readonly REQUIRE_UPPERCASE: boolean;
  readonly REQUIRE_LOWERCASE: boolean;
  readonly REQUIRE_NUMBER: boolean;
  readonly REQUIRE_SPECIAL: boolean;
  readonly REJECT_ALL_NUMERIC: boolean;
  readonly REJECT_COMMON_OR_COMPROMISED_PASSWORDS: boolean;
  readonly FORCE_PERIODIC_CHANGE: boolean;
}

const SHARED_PASSWORD_POLICY = {
  MAX_LENGTH: 64, // igual que PasswordPolicy.MAX_LENGTH del backend
  ALLOW_UNICODE: true,
  ALLOW_SPACES: false,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBER: true,
  REQUIRE_SPECIAL: true,
  REJECT_ALL_NUMERIC: true,
  REJECT_COMMON_OR_COMPROMISED_PASSWORDS: true,
  FORCE_PERIODIC_CHANGE: false,
} as const;

export const CUSTOMER_PASSWORD_POLICY = {
  ...SHARED_PASSWORD_POLICY,
  MIN_LENGTH: 8,
} as const satisfies PasswordPolicy;

export const EMPLOYEE_PASSWORD_POLICY = {
  ...SHARED_PASSWORD_POLICY,
  MIN_LENGTH: 12,
} as const satisfies PasswordPolicy;

const COMMON_OR_COMPROMISED_PASSWORDS = new Set([
  "password",
  "password1",
  "password1!",
  "password123!",
  "qwerty123!",
  "admin123!",
  "welcome123!",
  "letmein123!",
]);

/**
 * BCrypt solo usa los primeros 72 bytes: lo que sigue se ignora en silencio. El backend rechaza una
 * contraseña de mas de 72 bytes en UTF-8 con este mismo mensaje. Las tildes y la ñ ocupan 2 bytes y
 * los emojis 4, asi que una contraseña de 64 caracteres o menos tambien puede pasarse.
 */
export const PASSWORD_MAX_UTF8_BYTES = 72;
export const PASSWORD_TOO_MANY_BYTES_MESSAGE =
  "La contraseña es demasiado larga. Las tildes, la ñ y los emojis ocupan más espacio: usa una más corta o con menos caracteres especiales.";

const HAS_UPPERCASE = /\p{Lu}/u;
const HAS_LOWERCASE = /\p{Ll}/u;
const HAS_NUMBER = /\p{N}/u;
const HAS_REAL_SPECIAL = /[^\p{L}\p{N}\s]/u;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export function getPasswordRequirementsMessage(policy: PasswordPolicy): string {
  return `La contraseña debe tener entre ${policy.MIN_LENGTH} y ${policy.MAX_LENGTH} caracteres e incluir una mayúscula, una minúscula, un número y un carácter especial.`;
}

/**
 * Validador canónico único. `email` es contexto autoritativo del boundary que conoce la cuenta;
 * nunca un accountType declarado libremente por UI. Devuelve un mensaje público o null.
 */
export function validatePasswordAgainstPolicy(
  password: string,
  policy: PasswordPolicy,
  email?: string,
): string | null {
  if (!password) {
    return "La contraseña es obligatoria.";
  }

  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "La contraseña no puede ser igual al correo electrónico.";
  }

  if (password.length < policy.MIN_LENGTH || password.length > policy.MAX_LENGTH) {
    return getPasswordRequirementsMessage(policy);
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_UTF8_BYTES) {
    return PASSWORD_TOO_MANY_BYTES_MESSAGE;
  }
  if (!policy.ALLOW_SPACES && /\s/.test(password)) {
    return "La contraseña no puede contener espacios.";
  }
  if (policy.REJECT_ALL_NUMERIC && /^\p{N}+$/u.test(password)) {
    return "La contraseña no puede contener solo números.";
  }
  if (
    (policy.REQUIRE_UPPERCASE && !HAS_UPPERCASE.test(password)) ||
    (policy.REQUIRE_LOWERCASE && !HAS_LOWERCASE.test(password)) ||
    (policy.REQUIRE_NUMBER && !HAS_NUMBER.test(password)) ||
    (policy.REQUIRE_SPECIAL && !HAS_REAL_SPECIAL.test(password))
  ) {
    return getPasswordRequirementsMessage(policy);
  }
  if (
    policy.REJECT_COMMON_OR_COMPROMISED_PASSWORDS &&
    COMMON_OR_COMPROMISED_PASSWORDS.has(password.trim().toLowerCase())
  ) {
    return "La contraseña es demasiado común o está comprometida.";
  }
  return null;
}

export function validateCustomerPassword(password: string, email?: string): string | null {
  return validatePasswordAgainstPolicy(password, CUSTOMER_PASSWORD_POLICY, email);
}

export function validateEmployeePassword(password: string, email?: string): string | null {
  return validatePasswordAgainstPolicy(password, EMPLOYEE_PASSWORD_POLICY, email);
}

/**
 * One row per attempt number within the same failure window.
 * `delayMs` is the artificial delay applied before the next attempt is allowed.
 */
export interface LoginAttemptRule {
  attemptNumber: number;
  delayMs: number;
  triggersAntiBotChallenge: boolean;
  triggersLockout: boolean;
  lockoutMinutes?: number;
}

export const LOGIN_ATTEMPT_RULES: readonly LoginAttemptRule[] = [
  { attemptNumber: 1, delayMs: 0, triggersAntiBotChallenge: false, triggersLockout: false },
  { attemptNumber: 2, delayMs: 0, triggersAntiBotChallenge: false, triggersLockout: false },
  { attemptNumber: 3, delayMs: 30_000, triggersAntiBotChallenge: true, triggersLockout: false },
  { attemptNumber: 4, delayMs: 60_000, triggersAntiBotChallenge: true, triggersLockout: false },
  {
    attemptNumber: 5,
    delayMs: 0,
    triggersAntiBotChallenge: false,
    triggersLockout: true,
    lockoutMinutes: 15,
  },
] as const;

/** Failed attempts only count against each other within this window. */
export const FAILED_ATTEMPTS_WINDOW_MINUTES = 10;

/** Escalating lockout duration for repeated lockouts within the same 24h period. */
export const LOCKOUT_ESCALATION_MINUTES = {
  FIRST_LOCKOUT_IN_24H: 15,
  SECOND_LOCKOUT_IN_24H: 30,
  THIRD_LOCKOUT_IN_24H: 60,
} as const;

/** After this many minutes without new failures, the progressive policy resets. */
export const LOCKOUT_RESET_AFTER_MINUTES = 60;

/**
 * Generic, non-revealing messages required by rules R-A13/R-A14/R-A19.
 */
export const GENERIC_AUTH_ERROR_MESSAGE =
  "No fue posible iniciar sesión. Verifica tus credenciales o intenta más tarde.";

export const GENERIC_RECOVERY_MESSAGE = "Si existe una cuenta asociada, recibirás instrucciones.";

/**
 * Respuesta unica del registro de clientes y del reenvio de la verificacion de correo: es la
 * misma exista o no la cuenta, para no revelar que correos ya estan registrados (R-A03 sigue
 * vigente: el correo repetido no crea otra cuenta, pero la respuesta no lo delata). Es el mismo
 * texto que responde el backend en ambos endpoints.
 */
export const GENERIC_ACCOUNT_EMAIL_MESSAGE =
  "Si el correo es válido, te enviamos un mensaje para continuar.";

/** Espera de UI entre reenvios del correo de verificacion (el limite real lo aplica el backend). */
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 30;

/**
 * Doc section 4.10: customer email verification token expires in 30
 * minutes. This is intentionally a separate constant from
 * `EMPLOYEE_INVITATION_TOKEN_HOURS` below (24h) — that one matches the
 * doc's *employee invitation* token (section 4.4/4.10), a different flow
 * with its own owner and lifecycle. Do not reuse one for the other.
 */
export const EMAIL_VERIFICATION_TOKEN_MINUTES = 30;

/**
 * Doc secciones 4.4/4.10: el token de invitación de empleado vence en 24
 * horas. Se promueve a constante propia (PR9, mismo patrón que
 * EMAIL_VERIFICATION_TOKEN_MINUTES) ahora que el flujo de activación de
 * empleado ya se implementa — antes vivía solo como referencia dentro de
 * `authPolicy.emailVerificationTokenHours`. No confundir con
 * EMAIL_VERIFICATION_TOKEN_MINUTES (30 min, verificación de correo de
 * cliente): son dos flujos independientes con políticas independientes.
 */
export const EMPLOYEE_INVITATION_TOKEN_HOURS = 24;

/**
 * Doc R-A20/4.10: el link de restablecimiento de contraseña vence en 15
 * minutos -- NO 30. La constante legacy `authPolicy.passwordResetTokenMinutes`
 * decía 30, un valor que nunca coincidió con el documento porque nunca
 * hubo una pantalla real que lo hiciera observable; PR10 lo corrige al
 * exponerlo por primera vez.
 */
export const PASSWORD_RESET_TOKEN_MINUTES = 15;

/**
 * Doc R-A21: hasta 3 solicitudes de recuperación por cuenta antes de
 * entrar en cooldown.
 *
 * Simplificación deliberada frente al texto exacto del documento ("3 por
 * cuenta en una ventana de 15 minutos, luego cooldown de 30 minutos" --
 * dos relojes independientes): se implementa como un único corte de
 * PASSWORD_RESET_COOLDOWN_MINUTES (30) -- como máximo 3 solicitudes
 * pueden existir dentro de esa ventana; la 4ta (y siguientes) quedan
 * bloqueadas hasta que la más reciente permitida tenga más de 30 minutos
 * de antigüedad. Produce el mismo comportamiento observable que el
 * documento describe (3 pasan, la siguiente espera hasta 30 min desde la
 * última) sin necesitar dos relojes independientes.
 *
 * Reemplaza a `authPolicy.maxPasswordResetRequestsPerHour`, cuyo nombre
 * nunca correspondió a la regla real (no es "por hora").
 */
export const PASSWORD_RESET_REQUEST_LIMIT = 3;
export const PASSWORD_RESET_COOLDOWN_MINUTES = 30;

/**
 * Qué AccountStatus puede pasar por password recovery. Recovery y
 * activation/verification son máquinas de estado SEPARADAS -- recovery
 * nunca debe ser una puerta trasera para completar la otra:
 *
 * - active: el caso normal, "olvidé mi contraseña".
 * - temporarily_locked: doc 4.9 lo dice explícitamente ("puede usar el
 *   flujo de recuperación durante el bloqueo") y R-A24 ("al completar el
 *   reset se desbloquea una cuenta temporarily_locked") -- restablecer
 *   la contraseña es precisamente cómo se sale de este estado.
 *
 * Deliberadamente NO elegibles:
 * - password_reset_required: es el estado de una invitación de empleado
 *   sin activar (PR9) -- la única puerta de salida es
 *   activateEmployeeAccount()/[/activar-cuenta/[token]]. Si recovery
 *   también sacara de este estado, un empleado invitado podría saltarse
 *   por completo la activación (nunca "acepta" la invitación) con el
 *   mismo resultado final (cuenta active) -- dos máquinas de estado
 *   colapsando en una sin que ninguna lo decida explícitamente.
 * - pending_verification: análogo para el cliente que registró una
 *   cuenta pero no verificó su correo (PR8) -- la salida es
 *   verifyEmail()/[/verificar-correo/[token]], no recovery.
 * - disabled/archived: doc R-A18 ("cuentas disabled o archived no se
 *   reactivan con un login o reset; requieren una acción
 *   administrativa"). resetPassword() ya respeta esto para el status
 *   final de la cuenta (R-A25), pero antes de PR10-ronda2 SÍ generaba
 *   challenge y cambiaba la contraseña para estas cuentas -- ahora ni
 *   siquiera eso: si no está en este set, no hay challenge ni cambio de
 *   password posible via recovery.
 */
export const PASSWORD_RECOVERY_ELIGIBLE_STATUSES: readonly AccountStatus[] = [
  AccountStatus.active,
  AccountStatus.temporarily_locked,
];

export function isPasswordRecoveryEligible(status: AccountStatus): boolean {
  return PASSWORD_RECOVERY_ELIGIBLE_STATUSES.includes(status);
}

/**
 * Legacy flat policy, consumed today by MockAuthRepository.
 *
 * maxLoginAttempts and lockDurationMinutes are NOT independent values
 * anymore — they derive from LOGIN_ATTEMPT_RULES / LOCKOUT_ESCALATION_MINUTES
 * above, so there is a single canonical place to change the lockout rules.
 * The resulting numbers are unchanged (5 attempts, 15 min), so this does
 * not alter current MockAuthRepository behavior.
 *
 * maxPasswordResetRequestsPerHour and passwordResetTokenMinutes used to
 * live here as literal values -- PR10 replaces them with
 * PASSWORD_RESET_REQUEST_LIMIT/PASSWORD_RESET_COOLDOWN_MINUTES and
 * PASSWORD_RESET_TOKEN_MINUTES above, now that the recovery flow is
 * actually implemented and those values are observable. demoMode stays
 * here (still not consumed by anything).
 */
export const authPolicy = {
  maxLoginAttempts: LOGIN_ATTEMPT_RULES[LOGIN_ATTEMPT_RULES.length - 1].attemptNumber,
  lockDurationMinutes: LOCKOUT_ESCALATION_MINUTES.FIRST_LOCKOUT_IN_24H,
  demoMode: {
    enabled: false,
    lockDurationMinutes: 1,
    passwordResetTokenMinutes: 5,
  },
} as const;

/**
 * Given how many times an account has already been locked within the
 * last 24 hours (including the one about to happen), returns the
 * lockout duration in minutes per section 4.7's escalation table.
 */
export function getLockoutMinutesForOccurrence(occurrenceNumberIn24h: number): number {
  if (occurrenceNumberIn24h <= 1) return LOCKOUT_ESCALATION_MINUTES.FIRST_LOCKOUT_IN_24H;
  if (occurrenceNumberIn24h === 2) return LOCKOUT_ESCALATION_MINUTES.SECOND_LOCKOUT_IN_24H;
  return LOCKOUT_ESCALATION_MINUTES.THIRD_LOCKOUT_IN_24H;
}

/**
 * How far back to look when counting prior account_locked events for
 * escalation purposes (doc section 4.7 — 15/30/60 min escalation).
 */
export const LOCKOUT_ESCALATION_LOOKBACK_HOURS = 24;
