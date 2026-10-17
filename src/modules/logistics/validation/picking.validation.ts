import type { PickingIncidentType } from "@/core/enums";
import type { PickingDetailLineDto } from "@/modules/logistics/application/dto/PickingReadModelDto";

export interface PickingIncidentFormValues {
  pickingLineId: string;
  type: PickingIncidentType;
  quantityAffected: string;
  comment: string;
}

export function validatePickingLineUpdate(
  line: PickingDetailLineDto,
  targetQuantity: number,
  serialNumbers: string[],
): string | null {
  if (!Number.isFinite(targetQuantity) || targetQuantity < 0 || decimalPlaces(targetQuantity) > 3) {
    return "La cantidad debe ser válida y usar como máximo 3 decimales.";
  }
  if (targetQuantity <= line.pickedQuantity) {
    return "La nueva cantidad debe aumentar el progreso actual.";
  }
  if (targetQuantity > line.requiredQuantity) {
    return "La cantidad no puede superar la cantidad requerida.";
  }
  if (!line.tracking.serial && serialNumbers.length > 0) {
    return "Esta línea no requiere números de serie.";
  }
  if (line.tracking.serial) {
    if (!Number.isInteger(targetQuantity)) {
      return "Los productos serializados requieren una cantidad entera.";
    }
    const requiredSerials = targetQuantity - line.pickedQuantity;
    if (serialNumbers.length !== requiredSerials) {
      return `Selecciona exactamente ${requiredSerials} serie(s).`;
    }
    if (new Set(serialNumbers).size !== serialNumbers.length) {
      return "No puedes seleccionar una serie más de una vez.";
    }
    if (serialNumbers.some((serial) => !line.availableSerialNumbers.includes(serial))) {
      return "Selecciona únicamente series disponibles para esta reserva.";
    }
  }
  return null;
}

export function validatePickingIncident(values: PickingIncidentFormValues) {
  const errors: Partial<Record<keyof PickingIncidentFormValues, string>> = {};
  const comment = values.comment.trim();
  const quantityText = values.quantityAffected.trim();
  const quantityAffected = quantityText ? Number(quantityText) : undefined;

  if (!comment) errors.comment = "El comentario es obligatorio.";
  if (comment.length > 500) errors.comment = "Máximo 500 caracteres.";
  if (
    quantityAffected !== undefined &&
    (!Number.isFinite(quantityAffected) || quantityAffected <= 0 || decimalPlaces(quantityAffected) > 3)
  ) {
    errors.quantityAffected = "La cantidad debe ser mayor que cero y usar como máximo 3 decimales.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    command: {
      pickingLineId: values.pickingLineId || undefined,
      type: values.type,
      quantityAffected,
      comment,
    },
  };
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.includes(".") ? text.split(".")[1].length : 0;
}

export function validateReleaseReason(value: string): string | null {
  const reason = value.trim();
  if (!reason) return "El motivo es obligatorio.";
  if (reason.length > 500) return "Máximo 500 caracteres.";
  return null;
}
