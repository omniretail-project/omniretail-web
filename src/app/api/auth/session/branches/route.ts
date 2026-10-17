import type { NextRequest } from "next/server";
import { relaySessionRequest } from "@/app/api/_lib/backend";

/**
 * Modo api: sucursales activas asignadas al empleado de la sesion. No exige `admin.branches.read`;
 * el backend resuelve tenant y usuario desde el JWT y filtra por `allowedBranchIds`.
 */
export async function GET(request: NextRequest) {
  return relaySessionRequest(request, "/auth/session/branches", "GET");
}
