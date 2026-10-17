import {
  callBackend,
  forwardAuthBackendResponse,
  openSessionResponse,
  readAuthJson,
  serviceUnavailable,
} from "@/app/api/_lib/backend";
import { mfaVerifySchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: segundo paso del login (`{ challengeToken, code }`, validado con `mfaVerifySchema`). Si
 * el codigo es correcto, guarda el JWT en la cookie HttpOnly igual que el login (su vencimiento ya
 * refleja `rememberMe`) y devuelve SOLO la sesion actual (respuesta de /auth/me), nunca el token.
 * Los errores 4xx (MFA_CODE_INVALID, MFA_CHALLENGE_UNAVAILABLE) llegan con su `code` y `message`.
 *
 * El tipo de cuenta ya lo filtro el backend al abrir el desafio (`expectedUserType` del login).
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, mfaVerifySchema);
  if (!input.ok) return input.response;

  const verifyResponse = await callBackend("/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify(input.data),
  });
  if (!verifyResponse) return serviceUnavailable();
  if (!verifyResponse.ok) return forwardAuthBackendResponse(verifyResponse);

  const { token, expiresAt } = (await verifyResponse.json()) as { token: string; expiresAt: string };
  return openSessionResponse(token, expiresAt);
}
