export const EMAIL_MAX_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return "El correo electrónico es requerido.";
  if (normalized.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(normalized)) {
    return "El correo electrónico no es válido.";
  }
  return null;
}
