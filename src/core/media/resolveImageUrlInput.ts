import { isSafeCatalogImageUrl } from "@/core/media/catalogImage";

/**
 * Resultado de interpretar el texto que el usuario escribe en un campo "URL publica de imagen":
 * - `empty`: campo vacio (se quita la imagen).
 * - `valid`: URL http(s) o ruta same-origin segura; `src` ya viene sin espacios.
 * - `invalid`: aun no es una URL valida; solo se conserva como borrador, nunca se guarda.
 */
export type ImageUrlInput =
  | { status: "empty" }
  | { status: "valid"; src: string }
  | { status: "invalid" };

/** Coincide con `isSafeCatalogImageUrl`: URL http(s) o ruta del mismo sitio que empiece con "/". */
export const INVALID_IMAGE_URL_MESSAGE =
  "Ingrese una URL válida: debe comenzar con http:// o https://, o ser una ruta del sitio que empiece con /.";

/** Mensaje al intentar guardar con una URL de imagen invalida pendiente. */
export const INVALID_IMAGE_URL_SUBMIT_MESSAGE =
  "Corrija las URL de imagen inválidas antes de guardar. Mientras tanto se conserva la imagen anterior.";

export function resolveImageUrlInput(raw: string): ImageUrlInput {
  const trimmed = raw.trim();
  if (!trimmed) return { status: "empty" };
  return isSafeCatalogImageUrl(trimmed) ? { status: "valid", src: trimmed } : { status: "invalid" };
}
