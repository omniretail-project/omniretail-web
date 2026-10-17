import {
  CONVERSION_FACTOR_DECIMAL_PLACES,
  QUANTITY_DECIMAL_PLACES,
} from "@/shared/utils/inputLimits";

export type NumericInputValue = number | "" | `${number}.` | `${number}.${number}`;

export function isDecimalInputText(value: string) {
  return value === "" || /^\d+(?:\.\d*)?$/.test(value);
}

export function parseDecimalInput(
  value: string,
  maximumDecimalPlaces?: number,
): NumericInputValue {
  const normalized = value.trim();
  if (normalized === "" || !isDecimalInputText(normalized)) return "";
  if (normalized.endsWith(".")) return normalized as `${number}.`;
  if (
    maximumDecimalPlaces !== undefined &&
    !hasAtMostDecimalPlaces(normalized, maximumDecimalPlaces)
  ) {
    return normalized as `${number}.${number}`;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : "";
}

export function parseIntegerInput(value: string): NumericInputValue {
  const normalized = value.trim();
  if (normalized === "" || !/^\d+$/.test(normalized)) return "";
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : "";
}

export function toFiniteNumber(value: NumericInputValue, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function isPositiveInteger(value: NumericInputValue) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isPositiveNumber(value: NumericInputValue) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseUnitQuantityInput(value: string, unitAllowsDecimals: boolean) {
  return parseDecimalInput(value, unitAllowsDecimals ? QUANTITY_DECIMAL_PLACES : 0);
}

export function hasAtMostDecimalPlaces(value: number | string, maximumDecimalPlaces: number) {
  if (!Number.isSafeInteger(maximumDecimalPlaces) || maximumDecimalPlaces < 0) return false;
  if (typeof value === "string") {
    if (!/^\d+(?:\.\d*)?$/.test(value)) return false;
    return (value.split(".")[1]?.length ?? 0) <= maximumDecimalPlaces;
  }
  if (!Number.isFinite(value)) return false;
  const factor = 10 ** maximumDecimalPlaces;
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) return false;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

export function isQuantityCompatibleWithUnit(
  value: number | string,
  unitAllowsDecimals: boolean,
) {
  return unitAllowsDecimals
    ? hasAtMostDecimalPlaces(value, QUANTITY_DECIMAL_PLACES)
    : typeof value === "number" && Number.isInteger(value);
}

export function isConversionFactorCompatibleWithBaseUnit(
  factor: NumericInputValue,
  baseUnitAllowsDecimals: boolean,
) {
  return (
    isPositiveNumber(factor) &&
    hasAtMostDecimalPlaces(factor, CONVERSION_FACTOR_DECIMAL_PLACES) &&
    (baseUnitAllowsDecimals || (typeof factor === "number" && Number.isInteger(factor)))
  );
}
