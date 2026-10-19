/** Parametro que el login lee para mostrar el aviso de sesion expirada. */
export const SESSION_EXPIRED_PARAM = "sesion";
export const SESSION_EXPIRED_VALUE = "expirada";

const SESSION_EXPIRED_QUERY = `?${SESSION_EXPIRED_PARAM}=${SESSION_EXPIRED_VALUE}`;

/**
 * Login al que se envia a quien perdio la sesion a mitad de uso: el cliente vuelve al login de su
 * tienda (`/tienda/<slug>/...`) y el resto al login de personal. Pura para poder testearla.
 */
export function sessionExpiredLoginHref(pathname: string): string {
  const [first, slug] = pathname.split("/").filter(Boolean);
  if (first === "tienda" && slug) return `/tienda/${slug}/iniciar-sesion${SESSION_EXPIRED_QUERY}`;
  return `/iniciar-sesion${SESSION_EXPIRED_QUERY}`;
}
