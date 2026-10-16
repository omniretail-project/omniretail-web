import { z } from "zod";

/**
 * Esquemas de entrada de los Route Handlers de `/api/auth/**` (SOLO servidor). Cada uno replica
 * EXACTO el cuerpo que hoy envia `ApiAuthRepository`: `strictObject` rechaza cualquier campo de
 * mas, y al backend solo se reenvia el objeto ya validado, nunca el texto original.
 *
 * Los limites son de forma (tipo, largo, formato); las reglas finas (politica de contraseña,
 * vigencia de tokens) siguen siendo del backend y de los formularios.
 */

/** Mismo patron que los formularios de login, registro y recuperacion. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Mismo formato de slug que acepta el alta de tenants. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const email = z.string().trim().min(1).max(254).regex(EMAIL_PATTERN);
const tenantSlug = z.string().min(1).max(100).regex(SLUG_PATTERN);
/** Contraseña existente (login, contraseña actual): sin politica, solo un tope de tamaño. */
const currentPassword = z.string().min(1).max(256);
/** Contraseña nueva: la politica la aplica el backend; aqui solo un tope de tamaño. */
const newPassword = z.string().min(1).max(128);
/** Tokens de un solo uso (correo, recuperacion, invitacion) y desafios de MFA. */
const opaqueToken = z.string().min(1).max(512);
const otpCode = z.string().min(1).max(32);
const deviceLabel = z.string().max(120);

export const loginSchema = z.strictObject({
  email,
  password: currentPassword,
  rememberMe: z.boolean().optional(),
  deviceLabel: deviceLabel.optional(),
  tenantSlug: tenantSlug.optional(),
  expectedUserType: z.enum(["employee", "customer"]),
});

export const googleLoginSchema = z.strictObject({
  idToken: z.string().min(1).max(8192),
  tenantSlug,
  expectedUserType: z.literal("customer"),
  rememberMe: z.boolean().optional(),
  deviceLabel: deviceLabel.optional(),
});

export const mfaVerifySchema = z.strictObject({ challengeToken: opaqueToken, code: otpCode });

export const mfaResendSchema = z.strictObject({ challengeToken: opaqueToken });

export const mfaEnrollmentSchema = z.strictObject({ method: z.enum(["totp", "email"]) });

export const mfaEnrollmentVerifySchema = z.strictObject({ code: otpCode });

export const mfaDisableSchema = z.strictObject({ currentPassword });

export const registerSchema = z.strictObject({
  tenantSlug,
  name: z.string().trim().min(1).max(200),
  email,
  phone: z.string().max(30).optional(),
  password: newPassword,
});

export const verifyEmailSchema = z.strictObject({ token: opaqueToken });

/** El cliente normaliza igual que el backend: trim + minusculas. */
export const emailResendSchema = z.strictObject({
  email: email.toLowerCase(),
  tenantSlug,
});

export const forgotPasswordSchema = z.strictObject({ email, tenantSlug: tenantSlug.optional() });

export const resetPasswordSchema = z.strictObject({ token: opaqueToken, newPassword });

export const activateEmployeeSchema = z.strictObject({ token: opaqueToken, newPassword });

export const changePasswordSchema = z.strictObject({
  currentPassword,
  newPassword,
  mfaCode: otpCode.optional(),
});

export const sessionBranchSchema = z.strictObject({ branchId: z.string().min(1).max(100) });
