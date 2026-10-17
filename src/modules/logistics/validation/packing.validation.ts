import { DeliveryMethod } from "@/core/enums";
import type { PackingChecklist } from "@/core/entities";

export interface PackingPreparationFormValues {
  checklist: PackingChecklist;
  totalWeight: string;
  packageCount: string;
}

export interface PackingPreparationValidationResult {
  valid: boolean;
  errors: Partial<Record<"totalWeight" | "packageCount", string>>;
  values: {
    checklist: PackingChecklist;
    totalWeight?: number;
    packageCount?: number;
  };
}

export function validatePackingPreparation(
  deliveryMethod: DeliveryMethod | "transfer",
  form: PackingPreparationFormValues,
  options: { requireShipmentData?: boolean; backendPrecision?: boolean } = {},
): PackingPreparationValidationResult {
  const errors: PackingPreparationValidationResult["errors"] = {};
  const result: PackingPreparationValidationResult["values"] = {
    checklist: { ...form.checklist },
  };

  const shipmentData = options.requireShipmentData ??
    (deliveryMethod === DeliveryMethod.home_delivery || deliveryMethod === "transfer");
  if (shipmentData) {
    const weightText = form.totalWeight.trim();
    const packageCountText = form.packageCount.trim();
    if (weightText) {
      const totalWeight = Number(weightText);
      if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        errors.totalWeight = "Ingresa un peso mayor que cero.";
      } else if (options.backendPrecision && totalWeight > 999_999_999.999) {
        errors.totalWeight = "El peso admite como maximo nueve digitos enteros.";
      } else if (options.backendPrecision && !hasAtMostThreeDecimals(totalWeight)) {
        errors.totalWeight = "El peso admite como maximo tres decimales.";
      } else {
        result.totalWeight = totalWeight;
      }
    }
    if (packageCountText) {
      const packageCount = Number(packageCountText);
      if (!Number.isInteger(packageCount) || packageCount < 1) {
        errors.packageCount = "Ingresa al menos un bulto, usando un número entero.";
      } else {
        result.packageCount = packageCount;
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, values: result };
}

function hasAtMostThreeDecimals(value: number): boolean {
  return Math.abs(value * 1_000 - Math.round(value * 1_000)) < 1e-7;
}
