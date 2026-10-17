import { relaySessionRequest } from "@/app/api/_lib/backend";
import { mfaDisableSchema } from "@/app/api/_lib/authSchemas";

/** Modo api: desactiva el MFA con la contraseña actual (`{ currentPassword }`). Responde 204. */
export async function POST(request: Request) {
  return relaySessionRequest(request, "/auth/mfa/disable", "POST", mfaDisableSchema);
}
