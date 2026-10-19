import { relaySessionMutation } from "@/app/api/_lib/backend";
import { changePasswordSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: cambia la contraseña de la sesion actual con el token de la cookie HttpOnly
 * (`{ currentPassword, newPassword, mfaCode? }`, validado con `changePasswordSchema`). El backend
 * revoca las demas sesiones y mantiene esta, asi que la cookie no se toca. Responde 204, o el
 * ApiError 4xx con `fields.currentPassword` / `fields.newPassword` / `fields.mfaCode`.
 * Nunca se registra el cuerpo: lleva contraseñas.
 */
export async function POST(request: Request) {
  return relaySessionMutation(request, "/auth/password/change", "POST", changePasswordSchema);
}
