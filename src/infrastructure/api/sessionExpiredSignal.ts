/**
 * Aviso central, dentro de la pestaña, de que el backend rechazo la sesion con 401 a mitad de uso
 * (vencida, revocada o cerrada en otra pestaña). Lo emite `backendFetch` y lo escucha
 * `CurrentSessionProvider`, que limpia la sesion local y redirige al login: ninguna pantalla tiene
 * que tratar el 401 por su cuenta. Los 401 esperados del login y de MFA no pasan por aqui (van
 * por `/api/auth/*`, nunca por `backendFetch`).
 */
type SessionExpiredListener = () => void;

const listeners = new Set<SessionExpiredListener>();

export function notifySessionExpired(): void {
  for (const listener of [...listeners]) listener();
}

/** Devuelve la funcion que cancela la suscripcion. */
export function subscribeSessionExpired(listener: SessionExpiredListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
