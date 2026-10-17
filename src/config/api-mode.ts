/**
 * Modo de datos del frontend. `NEXT_PUBLIC_API_MODE` SOLO selecciona el modo; nunca contiene la URL
 * del backend (esa vive en `OMNIRETAIL_API_URL`, variable exclusiva del servidor que solo leen los
 * Route Handlers de `app/api/auth`).
 *
 * - `mock` (default): todo sigue usando los repositorios simulados.
 * - `api`: sesion, maestros migrados de Catalog y Product core pasan por el backend real;
 *   las relaciones de Product aun no migradas quedan explicitamente fuera del flujo API.
 */
export type ApiMode = "mock" | "api";

export function getApiMode(): ApiMode {
  return process.env.NEXT_PUBLIC_API_MODE === "api" ? "api" : "mock";
}

export function isApiMode(): boolean {
  return getApiMode() === "api";
}
