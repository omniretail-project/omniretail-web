import { readAuthJson, relayPublicAuthPost } from "@/app/api/_lib/backend";
import { forgotPasswordSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: solicita el enlace de recuperacion (`{ email, tenantSlug? }`, validado con
 * `forgotPasswordSchema`). El backend responde siempre el mismo 202 generico, exista o no la
 * cuenta (R-A19).
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, forgotPasswordSchema);
  if (!input.ok) return input.response;
  return relayPublicAuthPost("/auth/password/forgot", input.data);
}
