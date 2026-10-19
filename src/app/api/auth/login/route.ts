import { NextResponse } from "next/server";
import {
  callBackend,
  forwardAuthBackendResponse,
  openSessionResponse,
  readAuthJson,
  serviceUnavailable,
} from "@/app/api/_lib/backend";
import { loginSchema } from "@/app/api/_lib/authSchemas";

/** Respuesta del backend cuando el usuario tiene MFA activo: no trae token. */
interface MfaChallengeBody {
  mfaRequired: true;
  challengeToken: string;
  method: string;
  expiresAt: string;
}

/**
 * Modo api: inicia sesion en el backend, valida el tipo de cuenta esperado y solo entonces guarda
 * el JWT en la cookie HttpOnly. Devuelve al cliente SOLO la sesion actual (respuesta de /auth/me),
 * nunca el token.
 *
 * Antes de llamar al backend exige Origin propio, `Content-Type: application/json` y un cuerpo que
 * cumpla `loginSchema` (`expectedUserType` obligatorio). Al backend solo va el cuerpo validado: el
 * backend tambien filtra por `expectedUserType` antes de abrir un desafio de MFA, asi una cuenta de
 * otro tipo nunca llega al segundo paso.
 *
 * Con MFA activo el backend no crea sesion: se responde `{ status: "mfa_required", challengeId,
 * method }` SIN cookie, y la sesion se completa en `/api/auth/mfa/verify`.
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, loginSchema);
  if (!input.ok) return input.response;

  const loginResponse = await callBackend("/auth/login", {
    method: "POST",
    body: JSON.stringify(input.data),
  });
  if (!loginResponse) return serviceUnavailable();
  if (!loginResponse.ok) return forwardAuthBackendResponse(loginResponse);

  const loginBody = (await loginResponse.json()) as
    | { token: string; expiresAt: string }
    | MfaChallengeBody;
  if ("mfaRequired" in loginBody && loginBody.mfaRequired) {
    return NextResponse.json({
      status: "mfa_required",
      challengeId: loginBody.challengeToken,
      method: loginBody.method,
    });
  }
  const { token, expiresAt } = loginBody as { token: string; expiresAt: string };
  // El tipo real siempre sale de /auth/me: un tipo inesperado responde lo mismo que una contraseña
  // incorrecta, sin revelar que las credenciales eran validas para otro tipo de cuenta.
  return openSessionResponse(token, expiresAt, input.data.expectedUserType);
}
