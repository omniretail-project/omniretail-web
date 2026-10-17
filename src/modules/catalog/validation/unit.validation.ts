import { UnitCategory, UnitStatus } from "@/core/enums";
import type { UnitEditorDto, UnitListItem } from "@/modules/catalog/application/dto/UnitEditorDto";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";

export interface UnitValidationErrors {
  name?: string;
  symbol?: string;
  category?: string;
}

export function buildDefaultUnitDto(): UnitEditorDto {
  return {
    name: "",
    symbol: "",
    category: UnitCategory.unit,
    allowsDecimals: false,
    status: UnitStatus.active,
  };
}

export function unitToDto(unit: UnitListItem): UnitEditorDto {
  return {
    name: unit.name,
    symbol: unit.symbol,
    category: unit.category,
    allowsDecimals: unit.allowsDecimals,
    status: unit.status,
  };
}

export function validateUnitDto(
  dto: UnitEditorDto,
  units: UnitListItem[],
  currentUnitId?: string,
): UnitValidationErrors {
  const errors: UnitValidationErrors = {};
  const name = dto.name.trim();
  const symbol = dto.symbol.trim();

  if (!name) errors.name = "El nombre es requerido.";
  else if (dto.name.length > TEXT_LIMITS.unitName)
    errors.name = "El nombre admite hasta 40 caracteres.";
  if (!isUnitCategory(dto.category)) errors.category = "La categoria es requerida.";
  if (!symbol) {
    errors.symbol = "El simbolo es requerido.";
  } else if (!/^[\p{L}\p{N}./_-]+$/u.test(symbol)) {
    errors.symbol = "Usa letras, numeros, punto, diagonal, guion o guion bajo.";
  }
  if (dto.symbol.length > TEXT_LIMITS.unitSymbol)
    errors.symbol = "El simbolo admite hasta 10 caracteres.";

  const duplicate = units.find(
    (unit) =>
      unit.id !== currentUnitId &&
      (unit.name.trim().toLowerCase() === name.toLowerCase() ||
        unit.symbol.trim().toLowerCase() === symbol.toLowerCase()),
  );
  if (duplicate) {
    if (duplicate.name.trim().toLowerCase() === name.toLowerCase()) {
      errors.name = "Ya existe una unidad con este nombre.";
    }
    if (duplicate.symbol.trim().toLowerCase() === symbol.toLowerCase()) {
      errors.symbol = "Ya existe una unidad con este simbolo.";
    }
  }

  return errors;
}

export function hasUnitValidationErrors(errors: UnitValidationErrors) {
  return Object.values(errors).some(Boolean);
}

function isUnitCategory(value: unknown): value is UnitEditorDto["category"] {
  return (
    value === UnitCategory.unit ||
    value === UnitCategory.weight ||
    value === UnitCategory.length ||
    value === UnitCategory.volume ||
    value === UnitCategory.other
  );
}
