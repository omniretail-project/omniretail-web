import { notifySessionExpired } from "@/infrastructure/api/sessionExpiredSignal";

/**
 * Heartbeat de sesion (modo api): el backend expira la sesion del empleado tras 60 min sin requests,
 * y teclear o hacer scroll en un formulario largo no genera ninguno. `EmployeeInactivityTimeout` lo
 * llama solo mientras hay actividad real. Va directo a `/api/auth/me`, sin la cache de
 * `CurrentSessionClient`, para que cada ping llegue al backend. Nunca lanza: un 401 avisa la sesion
 * expirada (mismo flujo que `backendFetch`) y un error de red se ignora hasta el proximo ping.
 */
export async function pingSession(): Promise<void> {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) notifySessionExpired();
  } catch {
    // Sin red: el proximo ping o la siguiente peticion lo reintentan.
  }
}
