import type { LegacyBalanceRegularizationPreview } from "@/core/repositories";
import type { RegularizationDestination } from "@/modules/inventory/application/dto/InventoryRegularizationDto";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";

/** Longitud exacta del snapshotFingerprint que exige el backend (SHA-256 hexadecimal). */
export const REGULARIZATION_FINGERPRINT_LENGTH = 64;
export const REGULARIZATION_REASON_MAX = TEXT_LIMITS.reason;

/** Permiso adicional que exige la asignacion inicial (junto con inventory.adjustment.create). */
export const REGULARIZATION_ASSIGN_PERMISSION = "catalog.products.update";

export function validateRegularizationReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "Ingresa el motivo de la regularización.";
  if (trimmed.length > REGULARIZATION_REASON_MAX) {
    return `El motivo admite hasta ${REGULARIZATION_REASON_MAX} caracteres.`;
  }
  return null;
}

export interface RegularizationExecutionGate {
  allowed: boolean;
  /** Primer motivo por el que no se puede ejecutar (para mostrarlo al usuario). */
  blockedBy: string | null;
}

/**
 * Unica puerta para ejecutar. Destino asignado: flujo original (sin asignar). Destino sin asignar:
 * exige una ubicacion elegida entre las asignables, vista previa en modo asignacion con
 * `assignmentAllowed` y el permiso adicional de actualizar productos. En ambos casos: vista previa
 * vigente, elegible y sin bloqueos, fingerprint valido, motivo valido y permiso de ajuste. Un 409
 * anterior (`previewStale`) exige una vista previa nueva.
 */
export function evaluateRegularizationGate(input: {
  preview: LegacyBalanceRegularizationPreview | null;
  previewStale: boolean;
  destination: RegularizationDestination | null;
  /** Ubicacion elegida por el usuario cuando el producto no tiene asignada ninguna. */
  selectedLocationId?: string | null;
  reason: string;
  canAdjust: boolean;
  /** inventory.adjustment.create Y catalog.products.update. */
  canAssign: boolean;
}): RegularizationExecutionGate {
  const deny = (blockedBy: string): RegularizationExecutionGate => ({ allowed: false, blockedBy });
  if (!input.canAdjust) {
    return deny("No dispones del permiso para registrar ajustes de inventario.");
  }
  const destination = input.destination;
  if (destination?.kind === "locations_disabled") {
    return deny("El control de ubicaciones está desactivado en este negocio.");
  }
  if (destination?.kind === "unavailable") {
    return deny("No se pudo resolver la ubicación de inventario del producto.");
  }
  if (destination?.kind === "unassigned") {
    if (!input.canAssign) {
      return deny(
        "Asignar una ubicación inicial requiere permisos de ajustes de inventario y de actualización de productos.",
      );
    }
    if (!input.selectedLocationId) {
      return deny("Elige la ubicación que se asignará al producto.");
    }
    if (!destination.assignableLocations.some((item) => item.id === input.selectedLocationId)) {
      return deny("La ubicación elegida ya no está disponible. Elige otra.");
    }
  } else if (destination?.kind !== "assigned") {
    return deny("Consulta la información del producto antes de regularizar.");
  }
  if (!input.preview) return deny("Consulta la vista previa antes de regularizar.");
  if (input.previewStale) {
    return deny("El inventario puede haber cambiado. Actualiza la vista previa para continuar.");
  }
  const expectedLocationId =
    destination.kind === "assigned" ? destination.locationId : input.selectedLocationId;
  if (input.preview.locationId !== expectedLocationId) {
    return deny("La vista previa no corresponde a la ubicación seleccionada.");
  }
  if (destination.kind === "unassigned" && !input.preview.assignmentAllowed) {
    return deny("No es posible asignar esta ubicación al producto con tus permisos actuales.");
  }
  if (!input.preview.eligible || input.preview.blockers.length > 0) {
    return deny("La regularización tiene bloqueos que deben resolverse primero.");
  }
  if (input.preview.snapshotFingerprint.length !== REGULARIZATION_FINGERPRINT_LENGTH) {
    return deny("La vista previa no es válida. Vuelve a consultarla.");
  }
  const reasonError = validateRegularizationReason(input.reason);
  if (reasonError) return deny(reasonError);
  return { allowed: true, blockedBy: null };
}
