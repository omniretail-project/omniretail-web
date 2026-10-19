import { relaySessionRequest } from "@/app/api/_lib/backend";
import { mfaEnrollmentVerifySchema } from "@/app/api/_lib/authSchemas";

/** Modo api: confirma la activacion con el codigo de la app. Responde los 8 codigos de recuperacion. */
export async function POST(request: Request) {
  return relaySessionRequest(request, "/auth/mfa/enrollment/verify", "POST", mfaEnrollmentVerifySchema);
}
