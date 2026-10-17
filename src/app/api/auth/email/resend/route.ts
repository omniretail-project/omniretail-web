import { readAuthJson, relayPublicAuthPost } from "@/app/api/_lib/backend";
import { emailResendSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: reenvia el correo de verificacion de una cuenta de cliente pendiente (`{ email,
 * tenantSlug }`, validado con `emailResendSchema`; el correo se normaliza con trim + minusculas).
 * Endpoint publico, sin JWT. El backend responde siempre el mismo 202 `{ message }`, exista o no la
 * cuenta y este o no verificada; la UI muestra su propio mensaje generico sin leer el cuerpo.
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, emailResendSchema);
  if (!input.ok) return input.response;
  return relayPublicAuthPost("/auth/email/resend", input.data);
}
