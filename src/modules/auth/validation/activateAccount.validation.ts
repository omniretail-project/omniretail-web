import { validateEmployeePassword } from "@/config/auth-policy";

export interface ActivateAccountFormDto {
  password: string;
  confirmPassword: string;
}

export type ActivateAccountValidationErrors = Partial<
  Record<"password" | "confirmPassword", string>
>;

/**
 * La regla de password vive en config/auth-policy.ts
 * (validateEmployeePassword), NO duplicada aca -- es la misma
 * funcion que usa AuthRepository.activateEmployeeAccount() como barrera
 * real. Esta función es solo feedback inmediato de UI; una llamada
 * directa al repositorio no depende de esto para quedar protegida.
 */
export function validateActivateAccountForm(
  dto: ActivateAccountFormDto,
): ActivateAccountValidationErrors {
  const errors: ActivateAccountValidationErrors = {};

  const passwordError = validateEmployeePassword(dto.password);
  if (passwordError) {
    errors.password = passwordError;
  }

  if (!dto.confirmPassword) {
    errors.confirmPassword = "Confirma tu contraseña.";
  } else if (dto.password && dto.confirmPassword !== dto.password) {
    errors.confirmPassword = "Las contraseñas no coinciden.";
  }

  return errors;
}

export function hasActivateAccountValidationErrors(
  errors: ActivateAccountValidationErrors,
): boolean {
  return Object.keys(errors).length > 0;
}
