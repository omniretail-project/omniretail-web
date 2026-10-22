import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { CatalogServiceError } from "@/modules/catalog/application/services/serviceHelpers";

/**
 * Rechazos 409 del backend al archivar. El codigo es el contrato estable; el texto original del
 * backend no se muestra. Archivar un producto es una accion GLOBAL (todo el negocio): por eso estos
 * mensajes hablan de "cualquier sucursal". Un codigo desconocido conserva su error original.
 */
const ARCHIVE_ERROR_MESSAGES: Record<string, string> = {
  PRODUCT_ARCHIVE_HAS_STOCK:
    "No se puede archivar: el producto tiene existencias o reservas en al menos una sucursal. Archivar afecta a todo el negocio, así que primero hay que dejar su inventario en cero en todas las sucursales.",
  PRODUCT_ARCHIVE_HAS_OPEN_PO:
    "No se puede archivar: hay órdenes de compra abiertas que incluyen este producto. Recíbelas o cancélalas primero.",
  PRODUCT_ARCHIVE_IN_TRANSIT:
    "No se puede archivar: hay mercancía de este producto pendiente de recibir en un traslado ya despachado. Recibe o resuelve ese traslado primero.",
  KIT_COMPONENT_IN_USE:
    "No se puede archivar: el producto es componente de un kit publicado. Quítalo del kit o archiva el kit primero.",
  CATEGORY_HAS_PRODUCTS:
    "No se puede archivar la categoría: tiene productos no archivados asociados directamente. Reasígnalos a otra categoría o archívalos primero.",
  CATEGORY_HAS_ACTIVE_CHILDREN:
    "No se puede archivar la categoría: tiene subcategorías activas. Archiva o reubica primero las subcategorías.",
};

/** Devuelve un error con mensaje claro para un rechazo de archivado conocido; si no, el original. */
export function translateArchiveError(error: unknown): unknown {
  if (error instanceof BackendRequestError && error.code) {
    const message = ARCHIVE_ERROR_MESSAGES[error.code];
    if (message) return new CatalogServiceError(message);
  }
  return error;
}

export function getArchiveErrorMessage(code: string): string | undefined {
  return ARCHIVE_ERROR_MESSAGES[code];
}
