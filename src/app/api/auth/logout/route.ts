import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callBackend, sameOriginOrForbidden, serviceUnavailable, SESSION_COOKIE } from "@/app/api/_lib/backend";

/**
 * Modo api: revoca la sesion en el backend y SIEMPRE borra la cookie, aunque el backend responda
 * 401 (sesion ya revocada/vencida) o no responda. Sin cuerpo; exige Origin propio para que otro
 * sitio no pueda cerrar la sesion con un formulario (logout CSRF). Solo se chequea Origin (no la
 * disponibilidad del backend): la cookie se borra igual con el backend caido.
 */
export async function POST(request: Request) {
  const forbidden = sameOriginOrForbidden(request);
  if (forbidden) return forbidden;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const response = token ? await callBackend("/auth/logout", { method: "POST", token }) : undefined;
  cookieStore.delete(SESSION_COOKIE);
  if (response === null) return serviceUnavailable();
  return new NextResponse(null, { status: 204 });
}
