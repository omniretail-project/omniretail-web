import type { NextRequest } from "next/server";
import { relaySessionRequest } from "@/app/api/_lib/backend";

/** Modo api: estado del MFA de la sesion actual (`{ enabled, method }`). */
export async function GET(request: NextRequest) {
  return relaySessionRequest(request, "/auth/mfa", "GET");
}
