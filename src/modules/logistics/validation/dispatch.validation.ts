import { TransportMode } from "@/core/enums";
import type { ConfirmDispatchPackageDto } from "@/modules/logistics/application/dto/DispatchReadModelDto";

export interface DispatchFormValues {
  carrierName: string;
  trackingNumber: string;
  packages: Array<{
    number: string;
    weight: string;
    description: string;
  }>;
}

export interface DispatchValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  packages: ConfirmDispatchPackageDto[];
  carrierName?: string;
  trackingNumber?: string;
}

export interface DispatchShipmentFormValues {
  carrierName: string;
  trackingNumber: string;
}

export interface DispatchShipmentValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  carrierName?: string;
  trackingNumber?: string;
}

export function validateDispatchShipment(
  transportMode: TransportMode,
  values: DispatchShipmentFormValues,
): DispatchShipmentValidationResult {
  const errors: Record<string, string> = {};
  const carrierName = values.carrierName.trim() || undefined;
  const trackingNumber = values.trackingNumber.trim() || undefined;

  if (transportMode === TransportMode.third_party) {
    if (!carrierName) errors.carrierName = "El transporte es obligatorio.";
    if (!trackingNumber) errors.trackingNumber = "El número de guía es obligatorio.";
  }
  if (carrierName && carrierName.length > 200) {
    errors.carrierName = "Máximo 200 caracteres.";
  }
  if (trackingNumber && trackingNumber.length > 200) {
    errors.trackingNumber = "Máximo 200 caracteres.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    carrierName,
    trackingNumber,
  };
}

export function validateDispatchForm(
  transportMode: TransportMode,
  values: DispatchFormValues,
): DispatchValidationResult {
  const shipment = validateDispatchShipment(transportMode, values);
  const errors: Record<string, string> = { ...shipment.errors };
  if (values.packages.length === 0) errors.packages = "Agrega al menos un paquete.";

  const seen = new Set<string>();
  const packages = values.packages.map((item, index) => {
    const number = item.number.trim();
    const description = item.description.trim() || undefined;
    const weightText = item.weight.trim();
    const weight = weightText ? Number(weightText) : undefined;
    if (!number) errors[`package.${index}.number`] = "El número es obligatorio.";
    if (number.length > 80) errors[`package.${index}.number`] = "Máximo 80 caracteres.";
    const numberKey = number.toLocaleLowerCase();
    if (number && seen.has(numberKey)) {
      errors[`package.${index}.number`] = "El número no puede repetirse.";
    }
    seen.add(numberKey);
    if (weight !== undefined && (!Number.isFinite(weight) || weight <= 0)) {
      errors[`package.${index}.weight`] = "El peso debe ser mayor que cero.";
    }
    if (description && description.length > 500) {
      errors[`package.${index}.description`] = "Máximo 500 caracteres.";
    }
    return { number, weight, description };
  });

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    packages,
    carrierName: shipment.carrierName,
    trackingNumber: shipment.trackingNumber,
  };
}
