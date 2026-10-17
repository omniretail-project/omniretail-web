import type { NextRequest } from "next/server";
import { relaySessionRequest } from "@/app/api/_lib/backend";

/**
 * Modo api: capacidades y limites del plan del negocio de la sesion. No exige `admin.plans.read`;
 * el backend resuelve tenant y usuario desde el JWT y solo responde a empleados activos.
 */
export async function GET(request: NextRequest) {
  return relaySessionRequest(request, "/auth/session/entitlements", "GET");
}
