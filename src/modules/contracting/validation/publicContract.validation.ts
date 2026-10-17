import { validateEmployeePassword } from "@/config/auth-policy";

export interface PublicContractFormValues {
  businessName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  confirmPassword: string;
}

export type PublicContractFormErrors = Partial<Record<keyof PublicContractFormValues, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePublicContractForm(
  values: PublicContractFormValues,
): PublicContractFormErrors {
  const errors: PublicContractFormErrors = {};

  if (!values.businessName.trim()) errors.businessName = "El nombre del negocio es obligatorio.";
  if (!values.adminName.trim()) errors.adminName = "El nombre completo es obligatorio.";
  if (!values.adminEmail.trim()) {
    errors.adminEmail = "El correo electrónico es obligatorio.";
  } else if (!EMAIL_PATTERN.test(values.adminEmail.trim())) {
    errors.adminEmail = "Ingresa un correo electrónico válido.";
  }

  const passwordError = validateEmployeePassword(values.adminPassword, values.adminEmail);
  if (passwordError) errors.adminPassword = passwordError;

  if (!values.confirmPassword) {
    errors.confirmPassword = "Confirma tu contraseña.";
  } else if (values.adminPassword !== values.confirmPassword) {
    errors.confirmPassword = "Las contraseñas no coinciden.";
  }

  return errors;
}
