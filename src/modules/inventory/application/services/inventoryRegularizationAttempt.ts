import type {
  LegacyBalanceRegularizationPreview,
  RegularizeLocationBalanceInput,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RegularizationFailure } from "@/modules/inventory/application/dto/InventoryRegularizationDto";
import { InventoryServiceError } from "@/modules/inventory/application/services/serviceHelpers";

/**
 * Clasifica el fallo de un POST de regularizacion.
 *
 * - InventoryServiceError: la validacion local (permiso, sucursal, capacidad) fallo ANTES de enviar:
 *   definitivo.
 * - BackendRequestError: 4xx definitivo; status 0 (red), 408, 5xx (incluido el 503 del puente, que
 *   puede ocurrir despues de que el backend proceso la solicitud) e INVALID_BACKEND_RESPONSE (502)
 *   son inciertos.
 * - Cualquier otro error (p. ej. cuerpo 2xx ilegible) ocurre despues del envio: incierto. Nunca se
 *   asume que "no se aplico" ante la duda.
 */
export function classifyRegularizationFailure(error: unknown): RegularizationFailure {
  if (error instanceof InventoryServiceError) {
    return { kind: "definitive", message: error.message, local: true };
  }
  if (error instanceof BackendRequestError) {
    // KEY_REUSED tambien nace de una carrera de insercion entre dos envios de la MISMA clave (el
    // backend pide reintentar): hay que repetir la solicitud congelada, nunca generar otra clave.
    // BUSY: un bloqueo no se obtuvo a tiempo; nada se aplico y la solicitud puede repetirse tal cual,
    // asi que tambien conserva la solicitud congelada (sin clave nueva ni reenvio automatico).
    const uncertain =
      error.status === 0 ||
      error.status === 408 ||
      error.status >= 500 ||
      error.code === "INVENTORY_REGULARIZATION_KEY_REUSED" ||
      error.code === "INVENTORY_REGULARIZATION_BUSY";
    return {
      kind: uncertain ? "uncertain" : "definitive",
      status: error.status,
      ...(error.code ? { code: error.code } : {}),
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    };
  }
  return {
    kind: "uncertain",
    message: error instanceof Error ? error.message : "No se pudo confirmar el resultado.",
  };
}

/**
 * Congela la solicitud completa (clave, motivo recortado, cantidades esperadas y fingerprint de la
 * vista previa). Un reintento reenvia EXACTAMENTE este objeto: el backend liga la clave a la huella
 * del cuerpo y rechaza (409) la misma clave con otro contenido.
 */
export function freezeRegularizationRequest(input: {
  preview: LegacyBalanceRegularizationPreview;
  reason: string;
  idempotencyKey: string;
  /** Modo de la vista previa usada: asignacion inicial del destino. */
  assignDestination: boolean;
}): Readonly<RegularizeLocationBalanceInput> {
  const { preview } = input;
  return Object.freeze({
    branchId: preview.branchId,
    productId: preview.productId,
    locationId: preview.locationId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason.trim(),
    expectedSourceQuantity: preview.sourceQuantity,
    expectedSourceReservedQuantity: preview.sourceReservedQuantity,
    expectedDestinationQuantity: preview.destinationQuantity,
    snapshotFingerprint: preview.snapshotFingerprint,
    assignDestination: input.assignDestination,
  });
}
