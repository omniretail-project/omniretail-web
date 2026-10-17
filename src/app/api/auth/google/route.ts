import { NextResponse } from "next/server";
import {
  callBackend,
  forwardAuthBackendResponse,
  openSessionResponse,
  readAuthJson,
  serviceUnavailable,
} from "@/app/api/_lib/backend";
import { googleLoginSchema } from "@/app/api/_lib/authSchemas";

/** Respuesta del backend cuando el cliente tiene MFA activo: no trae token. */
interface MfaChallengeBody {
  mfaRequired: true;
  challengeToken: string;
  method: string;
}

/**
 * Modo api: "Continuar con Google" (solo clientes de la tienda). Valida `{ idToken, tenantSlug,
 * expectedUserType, rememberMe, deviceLabel }` (Origin, Content-Type y `googleLoginSchema`) y lo
 * reenvia al backend, que verifica el ID token con Google. Sin MFA guarda el JWT en la cookie
 * HttpOnly igual que el login; con MFA responde `{ status: "mfa_required", challengeId, method }`
 * SIN cookie. Los errores 4xx se reenvian reducidos a la allowlist y los 5xx con cuerpo generico.
 * Nunca se registra el cuerpo: lleva el ID token.
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, googleLoginSchema);
  if (!input.ok) return input.response;

  const response = await callBackend("/auth/google", { method: "POST", body: JSON.stringify(input.data) });
  if (!response) return serviceUnavailable();
  if (!response.ok) return forwardAuthBackendResponse(response);

  const body = (await response.json()) as { token: string; expiresAt: string } | MfaChallengeBody;
  if ("mfaRequired" in body && body.mfaRequired) {
    return NextResponse.json({ status: "mfa_required", challengeId: body.challengeToken, method: body.method });
  }
  const { token, expiresAt } = body as { token: string; expiresAt: string };
  // Solo clientes: el tipo se vuelve a comprobar con /auth/me como defensa extra.
  return openSessionResponse(token, expiresAt, "customer");
}
