import { readAuthJson, relayPublicAuthPost } from "@/app/api/_lib/backend";
import { mfaResendSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: reenvia el codigo por correo del segundo paso del login (`{ challengeToken }`). Es
 * publico (todavia no hay sesion) pero exige Origin, JSON y `mfaResendSchema`. Errores 4xx con su
 * `code`: 429 MFA_CODE_RESEND_LIMITED, 401 MFA_CHALLENGE_UNAVAILABLE, 400 MFA_RESEND_NOT_AVAILABLE.
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, mfaResendSchema);
  if (!input.ok) return input.response;
  return relayPublicAuthPost("/auth/mfa/resend", input.data);
}
