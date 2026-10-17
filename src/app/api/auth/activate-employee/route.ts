import { readAuthJson, relayPublicAuthPost } from "@/app/api/_lib/backend";
import { activateEmployeeSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: activa la cuenta de un empleado invitado (`{ token, newPassword }`, validado con
 * `activateEmployeeSchema`). Endpoint publico, sin JWT: el puente `/api/backend/*` bloquea
 * `/auth/**`, por eso tiene su propio Route Handler. Un 400 (INVALID_OR_EXPIRED_TOKEN o
 * VALIDATION_ERROR) llega con su `code`, `message` y `fields`; un exito sin cuerpo se reenvia vacio.
 */
export async function POST(request: Request) {
  const input = await readAuthJson(request, activateEmployeeSchema);
  if (!input.ok) return input.response;
  return relayPublicAuthPost("/auth/activate-employee", input.data);
}
