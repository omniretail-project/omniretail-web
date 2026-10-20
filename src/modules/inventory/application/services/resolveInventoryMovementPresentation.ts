import { InventoryMovementType } from "@/core/enums";
import type {
  InventoryMovementRow,
  MovementDisplayType,
} from "@/modules/inventory/application/dto/InventoryMovementsDto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSFER_REASON_PATTERN =
  /\b(Salida\s+por|Entrada\s+por|Recepción\s+de)\s+traslado\s+(TR-[A-Z0-9]+(?:-[A-Z0-9]+)+)\b/i;
const STORE_PICKUP_REASON_PATTERN =
  /^(?:Retiro en tienda entregado al cliente|Entrega de pedido(?:\s+POS-\d+)?)$/i;

export interface InventoryMovementPresentation {
  displayType: MovementDisplayType;
  typeLabel: string;
  referenceLabel: string;
}

/**
 * Resuelve etiquetas exclusivamente visuales. Los identificadores originales del movimiento
 * permanecen intactos para filtros, operaciones y auditoria.
 */
export function resolveInventoryMovementPresentation(
  movement: InventoryMovementRow,
): InventoryMovementPresentation {
  const reason = normalizeReason(movement.reason);
  const transferFromReason = TRANSFER_REASON_PATTERN.exec(reason);
  const referenceType = movement.referenceType?.toLowerCase();
  const structuredReference = getFriendlyReference(movement.referenceLabel);

  if (referenceType === "transfer" || transferFromReason) {
    const direction =
      movement.type === InventoryMovementType.out
        ? "out"
        : movement.type === InventoryMovementType.in
          ? "in"
          : transferFromReason
            ? transferFromReason[1].toLowerCase().startsWith("salida")
              ? "out"
              : "in"
            : null;
    return {
      displayType:
        direction === "out"
          ? "transfer_out"
          : direction === "in"
            ? "transfer_in"
            : movement.displayType,
      typeLabel:
        direction === "out"
          ? "Salida por traslado"
          : direction === "in"
            ? "Entrada por traslado"
            : movement.typeLabel,
      referenceLabel:
        structuredReference ??
        getFriendlyReference(movement.transferDetail?.number) ??
        transferFromReason?.[2] ??
        movement.referenceLabel,
    };
  }

  if (STORE_PICKUP_REASON_PATTERN.test(reason)) {
    return {
      displayType: "store_pickup",
      typeLabel: "Salida por entrega en tienda",
      referenceLabel: structuredReference ?? "Retiro en tienda",
    };
  }

  return {
    displayType: movement.displayType,
    typeLabel: movement.typeLabel,
    referenceLabel: movement.referenceLabel,
  };
}

function getFriendlyReference(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized === "-" || UUID_PATTERN.test(normalized)) return null;
  return normalized;
}

function normalizeReason(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}
