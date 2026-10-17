import { validateEmployeePassword } from "@/config/auth-policy";
import type { ChangePasswordFormDto } from "@/modules/auth/application/dto/ChangePasswordFormDto";

export type ChangePasswordValidationErrors = Partial<
  Record<"currentPassword" | "newPassword" | "confirmNewPassword", string>
>;

/**
 * Misma logica que modules/customer/validation/changePassword.validation.ts
 * (mismo flujo de cambio de contraseña para Employee/Admin) -- no se
 * reutiliza ese archivo directamente para no acoplar el modulo auth al
 * modulo customer; la unica regla real (PASSWORD_POLICY) ya vive
 * centralizada en config/auth-policy.ts; esta superficie Employee consume su wrapper desde
 * ahi, nunca duplicada.
 */
export function validateChangePasswordForm(
  dto: ChangePasswordFormDto,
): ChangePasswordValidationErrors {
  const errors: ChangePasswordValidationErrors = {};

  if (!dto.currentPassword) {
    errors.currentPassword = "Ingresa tu contraseña actual.";
  }

  const passwordError = validateEmployeePassword(dto.newPassword);
  if (passwordError) {
    errors.newPassword = passwordError;
  } else if (dto.currentPassword && dto.newPassword === dto.currentPassword) {
    errors.newPassword = "La nueva contraseña debe ser diferente a la actual.";
  }

  if (!dto.confirmNewPassword) {
    errors.confirmNewPassword = "Confirma tu nueva contraseña.";
  } else if (dto.newPassword && dto.confirmNewPassword !== dto.newPassword) {
    errors.confirmNewPassword = "Las contraseñas no coinciden.";
  }

  return errors;
}

export function hasChangePasswordValidationErrors(errors: ChangePasswordValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
