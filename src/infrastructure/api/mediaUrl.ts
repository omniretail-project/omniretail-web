const BACKEND_MEDIA_PREFIX = "/media/";
const FRONTEND_MEDIA_PREFIX = "/api/media/";
const API_UUID_SEGMENT =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const BACKEND_MANAGED_MEDIA_PATTERN = new RegExp(
  `^/media/${API_UUID_SEGMENT}/(?:categories|products|ecommerce)/${API_UUID_SEGMENT}/${API_UUID_SEGMENT}\\.(?:jpg|png|webp)$`,
);

export function isBackendManagedMediaUrl(url: string): boolean {
  return BACKEND_MANAGED_MEDIA_PATTERN.test(url);
}

/**
 * Convierte exclusivamente rutas locales administradas por el backend al proxy same-origin.
 * URLs externas y cualquier otra ruta se conservan sin cambios.
 */
export function toSameOriginMediaUrl(url: string): string {
  return isBackendManagedMediaUrl(url)
    ? `${FRONTEND_MEDIA_PREFIX}${url.slice(BACKEND_MEDIA_PREFIX.length)}`
    : url;
}

/** Revierte la ruta del proxy cuando un DTO existente debe volver al backend. */
export function toBackendMediaUrl(url: string): string {
  if (!url.startsWith(FRONTEND_MEDIA_PREFIX)) return url;
  const backendUrl = `${BACKEND_MEDIA_PREFIX}${url.slice(FRONTEND_MEDIA_PREFIX.length)}`;
  return isBackendManagedMediaUrl(backendUrl) ? backendUrl : url;
}
