const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Referencia amigable de un conteo fisico: CON- + 8 primeros caracteres del UUID. Solo display. */
export function formatCountReference(countId: string) {
  return UUID_PATTERN.test(countId) ? `CON-${countId.slice(0, 8).toUpperCase()}` : countId;
}

/**
 * Presentacion de la referencia de un movimiento. Solo transforma count_correction con un UUID;
 * el resto de referencias (OC-010, REC-019...) y valores no UUID se conservan tal cual.
 */
export function formatInventoryReference(
  referenceType: string | null | undefined,
  referenceId: string | null | undefined,
  fallbackLabel?: string | null,
) {
  if (!referenceId) return fallbackLabel || "-";
  if (referenceType === "count_correction" && UUID_PATTERN.test(referenceId)) {
    return formatCountReference(referenceId);
  }
  return fallbackLabel || referenceId;
}
