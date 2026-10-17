import { readAuthJson, relayPublicAuthPost } from "@/app/api/_lib/backend";
import { registerSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: registra un cliente en la tienda indicada. `{ tenantSlug, name, email, phone?,
 * password }` se valida con `registerSchema`; `tenantSlug` va en la ruta del backend y el resto en el
 * cuerpo. El backend responde siempre el mismo 202 `{ message, user: { name, email, type } }`, sea el
 * correo nuevo o ya registrado (sin id y sin 409): el token de verificacion viaja solo por correo y
 * la cuenta queda pendiente de verificar, sin sesion.
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, registerSchema);
  if (!input.ok) return input.response;
  const { tenantSlug, ...registration } = input.data;
  return relayPublicAuthPost(`/public/${encodeURIComponent(tenantSlug)}/auth/register`, registration);
}
