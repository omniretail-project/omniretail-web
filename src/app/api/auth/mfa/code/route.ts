import { relaySessionRequest } from "@/app/api/_lib/backend";

/**
 * Modo api: envia por correo un codigo para el cambio de contraseña (solo con el MFA por correo
 * activo). Sin cuerpo (solo exige Origin); responde 204. Errores 4xx con su `code`: 400
 * MFA_EMAIL_CODE_NOT_AVAILABLE, 429 MFA_CODE_RESEND_LIMITED.
 */
export async function POST(request: Request) {
  return relaySessionRequest(request, "/auth/mfa/code", "POST", null);
}
