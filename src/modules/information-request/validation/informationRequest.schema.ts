import { z } from "zod";
import {
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_NAME_MIN_LENGTH,
  CONSENT_VERSION,
  EMAIL_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  INDUSTRY_CODES,
  INTEREST_MODULE_CODES,
  MESSAGE_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  PHONE_MIN_LENGTH,
  type InformationRequestFieldErrors,
  type InformationRequestFormValues,
  type InformationRequestPayload,
} from "@/modules/information-request/application/dto/InformationRequestDto";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+() -]+$/;
const SINGLE_LINE_CONTROL_PATTERN = /[\p{Cc}\p{Cf}]/u;
const MESSAGE_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\p{Cf}/u;
const CONTROL_CHARACTER_MESSAGE = "No se permiten caracteres de control.";

function isSingleLineText(value: string) {
  return !SINGLE_LINE_CONTROL_PATTERN.test(value);
}

function isSafeMessage(value: string) {
  return !MESSAGE_CONTROL_PATTERN.test(value);
}

/**
 * Esquema único de la solicitud: lo usan el formulario, el servicio cliente y el Route Handler.
 * Cada comprobación de controles ocurre antes de `trim`/`toLowerCase`, para que la normalización
 * nunca convierta silenciosamente una entrada inválida en una válida. `strictObject` rechaza
 * cualquier campo de más.
 */
export const informationRequestSchema = z.strictObject({
  fullName: z
    .string()
    .refine(isSingleLineText, CONTROL_CHARACTER_MESSAGE)
    .max(FULL_NAME_MAX_LENGTH, "El nombre admite hasta 100 caracteres.")
    .trim()
    .min(FULL_NAME_MIN_LENGTH, "Ingresa tu nombre completo."),
  businessName: z
    .string()
    .refine(isSingleLineText, CONTROL_CHARACTER_MESSAGE)
    .max(BUSINESS_NAME_MAX_LENGTH, "El nombre comercial admite hasta 120 caracteres.")
    .trim()
    .min(BUSINESS_NAME_MIN_LENGTH, "Ingresa el nombre comercial de tu empresa."),
  email: z
    .string()
    .refine(isSingleLineText, CONTROL_CHARACTER_MESSAGE)
    .max(EMAIL_MAX_LENGTH, "El correo admite hasta 254 caracteres.")
    .trim()
    .toLowerCase()
    .min(1, "Ingresa tu correo electrónico.")
    .regex(EMAIL_PATTERN, "Ingresa un correo electrónico válido."),
  phone: z
    .string()
    .refine((value) => value.trim().length > 0, "Ingresa un teléfono de contacto.")
    .max(PHONE_MAX_LENGTH, "El teléfono admite hasta 20 caracteres.")
    .regex(PHONE_PATTERN, "Usa solo números, espacios y los símbolos + ( ) -")
    .trim()
    .min(PHONE_MIN_LENGTH, "El teléfono debe tener al menos 7 caracteres."),
  industry: z.enum(INDUSTRY_CODES, { error: "Selecciona el rubro de tu negocio." }),
  modules: z
    .array(z.enum(INTEREST_MODULE_CODES))
    .min(1, "Selecciona al menos un módulo de interés.")
    .max(INTEREST_MODULE_CODES.length, "Selección de módulos no válida.")
    .refine((modules) => new Set(modules).size === modules.length, {
      message: "Selección de módulos no válida.",
    }),
  message: z
    .string()
    .refine(isSafeMessage, CONTROL_CHARACTER_MESSAGE)
    .max(MESSAGE_MAX_LENGTH, "Los comentarios admiten hasta 1,000 caracteres.")
    .trim(),
  consentAccepted: z.literal(true, {
    error: "Debes aceptar para que podamos responder tu solicitud.",
  }),
  consentVersion: z.literal(CONSENT_VERSION),
  website: z.string().max(200),
  captchaToken: z.string().max(2048),
});

export type ValidatedInformationRequest = z.output<typeof informationRequestSchema>;

/** Primer mensaje por campo de un error de zod. */
export function toFieldErrors(error: z.ZodError): InformationRequestFieldErrors {
  const errors: InformationRequestFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || key in errors) continue;
    errors[key as keyof InformationRequestFormValues] = issue.message;
  }
  return errors;
}

export type InformationRequestValidation =
  | { ok: true; payload: InformationRequestPayload }
  | { ok: false; errors: InformationRequestFieldErrors };

/** Valida los valores del formulario y arma el cuerpo exacto del contrato. */
export function validateInformationRequest(
  values: InformationRequestFormValues,
): InformationRequestValidation {
  const result = informationRequestSchema.safeParse({
    fullName: values.fullName,
    businessName: values.businessName,
    email: values.email,
    phone: values.phone,
    industry: values.industry,
    modules: values.modules,
    message: values.message,
    consentAccepted: values.consentAccepted,
    consentVersion: CONSENT_VERSION,
    website: values.website,
    captchaToken: values.captchaToken,
  });
  if (!result.success) return { ok: false, errors: toFieldErrors(result.error) };
  return { ok: true, payload: result.data };
}
