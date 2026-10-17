export interface RequestPasswordResetFormDto {
  email: string;
}

export type RequestPasswordResetValidationErrors = Partial<Record<"email", string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRequestPasswordResetForm(
  dto: RequestPasswordResetFormDto,
): RequestPasswordResetValidationErrors {
  const errors: RequestPasswordResetValidationErrors = {};

  if (!dto.email.trim()) {
    errors.email = "El correo es obligatorio.";
  } else if (!EMAIL_PATTERN.test(dto.email.trim())) {
    errors.email = "Ingrese un correo con formato válido.";
  }

  return errors;
}

export function hasRequestPasswordResetValidationErrors(
  errors: RequestPasswordResetValidationErrors,
): boolean {
  return Object.keys(errors).length > 0;
}
