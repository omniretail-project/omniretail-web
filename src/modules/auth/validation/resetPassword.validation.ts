import { validateCustomerPassword } from "@/config/auth-policy";

export interface ResetPasswordFormDto {
  password: string;
  confirmPassword: string;
}

export type ResetPasswordValidationErrors = Partial<Record<"password" | "confirmPassword", string>>;

/**
 * La regla de password vive en config/auth-policy.ts
 * (validateCustomerPassword como mínimo seguro en UI), NO duplicada aca -- el repositorio
 * resuelve Customer/Employee desde el token y vuelve a validar con la policy autoritativa. Es la misma
 * funcion que usa AuthRepository.resetPassword() como barrera real
 * (mismo patrón que activateAccount.validation.ts desde PR9). Esta
 * función es solo feedback inmediato de UI; una llamada directa al
 * repositorio no depende de esto para quedar protegida.
 */
export function validateResetPasswordForm(
  dto: ResetPasswordFormDto,
): ResetPasswordValidationErrors {
  const errors: ResetPasswordValidationErrors = {};

  // El token puede pertenecer a Customer o Employee. La UI aplica el mínimo Customer para no
  // bloquear una contraseña Customer válida; el repositorio resuelve el UserType autoritativo y
  // vuelve a validar con la política exacta antes de mutar.
  const passwordError = validateCustomerPassword(dto.password);
  if (passwordError) {
    errors.password = passwordError;
  }

  if (!dto.confirmPassword) {
    errors.confirmPassword = "Confirme la contraseña.";
  } else if (dto.password && dto.confirmPassword !== dto.password) {
    errors.confirmPassword = "Las contraseñas no coinciden.";
  }

  return errors;
}

export function hasResetPasswordValidationErrors(errors: ResetPasswordValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
