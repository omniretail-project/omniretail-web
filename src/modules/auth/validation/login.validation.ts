import type { LoginFormDto } from "@/modules/auth/application/dto/LoginFormDto";

export type LoginFormValidationErrors = Partial<Record<"email" | "password", string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validacion minima segun tabla 4.26 del documento (formato de correo
 * valido). NO valida fuerza/complejidad de password aqui -- eso aplica a
 * registro/reset (políticas Customer/Employee en auth-policy.ts), no a login.
 */
export function validateLoginForm(dto: LoginFormDto): LoginFormValidationErrors {
  const errors: LoginFormValidationErrors = {};

  if (!dto.email.trim()) {
    errors.email = "El correo es obligatorio.";
  } else if (!EMAIL_PATTERN.test(dto.email.trim())) {
    errors.email = "Ingrese un correo con formato válido.";
  }

  // .trim() aqui es SOLO para la comprobacion de vacio -- no muta dto.password.
  // El valor original (con los espacios que tenga) sigue intacto y es el que
  // se envia despues a AuthRepository.login(), sin modificar.
  if (!dto.password.trim()) {
    errors.password = "La contraseña es obligatoria.";
  }

  return errors;
}

export function hasLoginValidationErrors(errors: LoginFormValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
