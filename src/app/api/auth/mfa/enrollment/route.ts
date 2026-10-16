import { relaySessionRequest } from "@/app/api/_lib/backend";
import { mfaEnrollmentSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: inicia la activacion del MFA (`{ method: "totp" | "email" }`). Responde `{ method,
 * secret, otpauthUri }`; el QR se genera solo en el navegador.
 */
export async function POST(request: Request) {
  return relaySessionRequest(request, "/auth/mfa/enrollment", "POST", mfaEnrollmentSchema);
}
