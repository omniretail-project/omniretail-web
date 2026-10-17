import { readAuthJson, relayPublicAuthPost } from "@/app/api/_lib/backend";
import { resetPasswordSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: fija la nueva contraseña con el token del enlace (`{ token, newPassword }`, validado con
 * `resetPasswordSchema`). Responde `{ userType, tenantSlug? }`; no inicia sesion (el usuario vuelve
 * a iniciar sesion con la nueva contraseña).
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, resetPasswordSchema);
  if (!input.ok) return input.response;
  return relayPublicAuthPost("/auth/password/reset", input.data);
}
