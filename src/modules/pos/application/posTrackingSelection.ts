import type { PosApiTrackingSelection } from "@/core/repositories";

const QUANTITY_SCALE = 1000;
const MAX_TRACKING_QUANTITY = 999_999_999.999;

/**
 * Convierte una cantidad de inventario a la precision admitida por el backend sin redondear una
 * cuarta cifra decimal valida por accidente.
 */
export function normalizePosTrackingQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_TRACKING_QUANTITY) {
    throw new Error("La cantidad trazable debe ser positiva y no superar 999999999.999.");
  }
  const scaled = quantity * QUANTITY_SCALE;
  const rounded = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  if (Math.abs(scaled - rounded) > tolerance) {
    throw new Error("La cantidad trazable admite como maximo tres decimales.");
  }
  return rounded / QUANTITY_SCALE;
}

/**
 * Produce una copia estable para persistencia, fingerprint y reintentos. No combina selecciones:
 * cada lote y ubicacion conserva exactamente su cantidad fisica.
 */
export function canonicalizePosTrackingSelections(
  selections: PosApiTrackingSelection[],
): PosApiTrackingSelection[] {
  const seenSerials = new Set<string>();
  const normalized = selections.map((selection) => {
    const serialNumbers = (selection.serialNumbers ?? []).map((serial) => {
      if (serial.length > 100 || !serial.trim()) {
        throw new Error("Los numeros de serie deben tener entre 1 y 100 caracteres.");
      }
      const value = serial.trim();
      if (seenSerials.has(value)) {
        throw new Error(`El numero de serie ${value} esta repetido.`);
      }
      seenSerials.add(value);
      return value;
    });

    return {
      productId: selection.productId,
      locationId: selection.locationId,
      lotId: selection.lotId ?? null,
      quantity: normalizePosTrackingQuantity(selection.quantity),
      serialNumbers: serialNumbers.sort(compareText),
    };
  });

  return normalized.sort((left, right) => compareText(selectionKey(left), selectionKey(right)));
}

function selectionKey(selection: PosApiTrackingSelection): string {
  return JSON.stringify([
    selection.productId,
    selection.locationId,
    selection.lotId ?? null,
    selection.quantity,
    selection.serialNumbers ?? [],
  ]);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
