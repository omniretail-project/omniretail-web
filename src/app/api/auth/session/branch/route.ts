import { relaySessionMutation } from "@/app/api/_lib/backend";
import { sessionBranchSchema } from "@/app/api/_lib/authSchemas";

/**
 * Modo api: guarda la sucursal activa en la sesion del backend con el token de la cookie HttpOnly
 * (`{ branchId }`, validado con `sessionBranchSchema`). El backend decide si esta permitida: 200 con
 * la misma forma que /auth/me, o el ApiError 4xx (p. ej. 403 BRANCH_NOT_ALLOWED). La sesion sigue
 * siendo la misma, asi que la cookie no se toca.
 */
export async function PATCH(request: Request) {
  return relaySessionMutation(request, "/auth/session/branch", "PATCH", sessionBranchSchema);
}
