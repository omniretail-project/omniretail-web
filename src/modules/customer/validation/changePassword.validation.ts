import { validateCustomerPassword } from "@/config/auth-policy";
import type { ChangePasswordFormDto } from "@/modules/customer/application/dto/ChangePasswordFormDto";

export type ChangePasswordValidationErrors = Partial<
  Record<"currentPassword" | "newPassword" | "confirmNewPassword", string>
>;

/**
 * La regla de password vive en config/auth-policy.ts
 * (validateCustomerPassword), NO duplicada aca -- es la misma
 * funcion que usa AuthRepository.changePassword() como barrera real
 * (mismo patrón que resetPassword.validation.ts). Esta función es solo
 * feedback inmediato de UI; una llamada directa al repositorio no
 * depende de esto para quedar protegida.
 */
export function validateChangePasswordForm(
  dto: ChangePasswordFormDto,
): ChangePasswordValidationErrors {
  const errors: ChangePasswordValidationErrors = {};

  if (!dto.currentPassword) {
    errors.currentPassword = "Ingresa tu contraseña actual.";
  }

  const passwordError = validateCustomerPassword(dto.newPassword);
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
