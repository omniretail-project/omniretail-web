import { validateEmail, normalizeEmail } from "@/config/email-policy";
import type { EmailSenderConfigInputDto } from "@/modules/administration/application/dto/EmailSenderConfigDto";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";

export const EMAIL_SENDER_NAME_MAX_LENGTH = 100;
/** Las contraseñas de aplicación de Google tienen 16 caracteres; se muestran en grupos de 4. */
export const APP_PASSWORD_LENGTH = 16;

/** Quita los espacios con que Google muestra la contraseña ("abcd efgh ijkl mnop"). */
export function normalizeAppPassword(value: string): string {
  return value.replace(/\s+/g, "");
}

export type EmailSenderFieldErrors = Partial<Record<"senderEmail" | "senderName" | "appPassword", string>>;

export function getEmailSenderFieldErrors(
  input: EmailSenderConfigInputDto,
  options: { passwordRequired: boolean },
): EmailSenderFieldErrors {
  const errors: EmailSenderFieldErrors = {};

  const emailError = validateEmail(input.senderEmail);
  if (emailError) errors.senderEmail = emailError;

  const name = input.senderName.trim();
  if (!name) errors.senderName = "El nombre del remitente es requerido.";
  else if (name.length > EMAIL_SENDER_NAME_MAX_LENGTH) {
    errors.senderName = `El nombre no puede superar ${EMAIL_SENDER_NAME_MAX_LENGTH} caracteres.`;
  }

  const password = normalizeAppPassword(input.appPassword ?? "");
  if (!password) {
    if (options.passwordRequired) errors.appPassword = "La contraseña de aplicación es requerida.";
  } else if (!/^[a-z0-9]+$/i.test(password) || password.length !== APP_PASSWORD_LENGTH) {
    errors.appPassword = `La contraseña de aplicación de Google tiene ${APP_PASSWORD_LENGTH} caracteres.`;
  }

  return errors;
}

export function validateEmailSenderInput(
  input: EmailSenderConfigInputDto,
  options: { passwordRequired: boolean },
): void {
  const [firstError] = Object.values(getEmailSenderFieldErrors(input, options));
  if (firstError) throw new AdministrationServiceError(firstError);
}

export function normalizeEmailSenderInput(input: EmailSenderConfigInputDto) {
  const appPassword = normalizeAppPassword(input.appPassword ?? "");
  return {
    senderEmail: normalizeEmail(input.senderEmail),
    senderName: input.senderName.trim(),
    appPassword: appPassword || undefined,
  };
}
