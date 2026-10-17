import { readAuthJson, relayPublicAuthPost } from "@/app/api/_lib/backend";
import { verifyEmailSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: verifica el correo de un cliente con el token del enlace (`{ token }`, validado con
 * `verifyEmailSchema`). Responde `{ tenantSlug }`.
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, verifyEmailSchema);
  if (!input.ok) return input.response;
  return relayPublicAuthPost("/auth/email/verify", input.data);
}
