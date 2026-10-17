import { validateCustomerPassword } from "@/config/auth-policy";
import { validatePhoneNumber } from "@/config/contact-policy";
import type { RegisterFormDto } from "@/modules/auth/application/dto/RegisterFormDto";

export type RegisterFormValidationErrors = Partial<
  Record<"name" | "email" | "phone" | "password" | "confirmPassword", string>
>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validacion de cliente (formato/longitud/campos requeridos). NO
 * sustituye las invariantes de dominio del repositorio -- en particular,
 * email unico por tenant (R-A03) solo lo garantiza
 * MockAuthRepository.registerCustomer(), no esta funcion. Existe para dar
 * feedback inmediato sin round-trip, nada mas.
 */
export function validateRegisterForm(dto: RegisterFormDto): RegisterFormValidationErrors {
  const errors: RegisterFormValidationErrors = {};

  if (!dto.name.trim()) {
    errors.name = "El nombre es obligatorio.";
  }

  if (!dto.email.trim()) {
    errors.email = "El correo es obligatorio.";
  } else if (!EMAIL_PATTERN.test(dto.email.trim())) {
    errors.email = "Ingrese un correo con formato válido.";
  }

  // Telefono es opcional (RegisterCustomerInput.phone?) -- solo se valida
  // si el usuario escribio algo. Antes solo chequeaba el largo minimo,
  // sin exigir que fueran solo digitos (ej. "abcdefgh" pasaba). Funcion
  // canonica compartida con profile.validation.ts.
  const phoneError = validatePhoneNumber(dto.phone);
  if (phoneError) {
    errors.phone = phoneError;
  }

  // Antes esto duplicaba a mano las reglas de Customer password (longitud,
  // espacios) en vez de llamar a la funcion canonica -- por eso una
  // regla nueva agregada ahi (rechazar solo-numeros) nunca llegaba a
  // este formulario. Mismo patron que el resto de los formularios de
  // auth (resetPassword.validation.ts, changePassword.validation.ts):
  // una sola fuente de verdad, la funcion canonica, nunca una copia.
  const passwordError = validateCustomerPassword(dto.password, dto.email);
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

export function hasRegisterValidationErrors(errors: RegisterFormValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
