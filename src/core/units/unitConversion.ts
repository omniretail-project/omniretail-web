import type { UnitConversion } from "@/core/entities";

export class UnitConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitConversionError";
  }
}

export interface UnitConversionContext {
  sourceUnitId: string;
  baseUnitId: string;
  conversions: ReadonlyArray<Pick<UnitConversion, "fromUnitId" | "toUnitId" | "factor">>;
}

export function resolveUnitConversion(context: UnitConversionContext): number {
  if (!context.sourceUnitId || !context.baseUnitId) {
    throw new UnitConversionError("La unidad origen y la unidad base son requeridas.");
  }
  if (context.sourceUnitId === context.baseUnitId) return 1;

  const conversion = context.conversions.find(
    (item) =>
      item.fromUnitId === context.sourceUnitId && item.toUnitId === context.baseUnitId,
  );
  if (!conversion) {
    throw new UnitConversionError("No existe conversion de la unidad seleccionada a la unidad base.");
  }
  if (!Number.isFinite(conversion.factor) || conversion.factor <= 0) {
    throw new UnitConversionError("El factor de conversion debe ser finito y mayor que cero.");
  }
  return conversion.factor;
}

export function toBaseQuantity(
  quantity: number,
  context: UnitConversionContext & { requireInteger?: boolean },
): number {
  assertFiniteQuantity(quantity);
  const result = quantity * resolveUnitConversion(context);
  assertFiniteQuantity(result);
  if (context.requireInteger && !Number.isSafeInteger(result)) {
    throw new UnitConversionError("La cantidad convertida debe producir unidades base enteras.");
  }
  return result;
}

export function fromBaseQuantity(
  quantity: number,
  context: Omit<UnitConversionContext, "sourceUnitId"> & { targetUnitId: string },
): number {
  assertFiniteQuantity(quantity);
  const factor = resolveUnitConversion({
    sourceUnitId: context.targetUnitId,
    baseUnitId: context.baseUnitId,
    conversions: context.conversions,
  });
  const result = quantity / factor;
  assertFiniteQuantity(result);
  return result;
}

function assertFiniteQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) {
    throw new UnitConversionError("La cantidad debe ser un numero finito.");
  }
}
