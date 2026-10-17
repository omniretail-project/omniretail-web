import type {
  AdjustStockDto,
  BranchStockSummary,
  InventoryProductRow,
  TransferRequestDto,
} from "@/modules/inventory/application/dto/InventoryAlertsDto";
import {
  EXPIRATION_BEFORE_ENTRY_MESSAGE,
  getLocalCalendarDate,
  isExpirationBeforeOperationDate,
} from "@/core/inventory/expirationDate";
import { MAX_SAFE_INVENTORY_QUANTITY, TEXT_LIMITS } from "@/shared/utils/inputLimits";
import { isQuantityCompatibleWithUnit } from "@/shared/utils/numberInput";

export interface AdjustmentValidationErrors {
  quantity?: string;
  reason?: string;
  locationId?: string;
  lotId?: string;
  lotNumber?: string;
  expirationDate?: string;
  serialNumbers?: string;
  notes?: string;
}

export interface TransferValidationErrors {
  providerBranchId?: string;
  quantity?: string;
  reason?: string;
  notes?: string;
}

export function validateAdjustment(
  dto: AdjustStockDto,
  row: InventoryProductRow,
  stock: { quantity: number; availableQuantity: number },
  operationDate = getLocalCalendarDate(),
  requiresLocation = true,
): AdjustmentValidationErrors {
  const errors: AdjustmentValidationErrors = {};
  // Sin "Multiples ubicaciones" el ajuste va sin ubicacion: no se exige ni se inventa una.
  if (requiresLocation && !dto.locationId) errors.locationId = "Selecciona una ubicacion.";
  if (!Number.isFinite(dto.quantity) || dto.quantity < 0) {
    errors.quantity = "Ingresa una cantidad valida.";
  } else if (dto.quantity > MAX_SAFE_INVENTORY_QUANTITY) {
    errors.quantity = "La cantidad no puede superar 999,999.99.";
  } else if (row.tracking.serial && !Number.isInteger(dto.quantity)) {
    errors.quantity = "Los productos con series requieren una cantidad entera.";
  } else if (dto.movementKind !== "count" && dto.quantity <= 0) {
    errors.quantity = "La cantidad debe ser mayor que cero.";
  } else if (
    (dto.movementKind === "out" || dto.movementKind === "waste") &&
    dto.quantity > stock.availableQuantity
  ) {
    errors.quantity = "No puede generar stock negativo.";
  } else if (
    dto.movementKind === "count" &&
    stock.quantity - dto.quantity > stock.availableQuantity
  ) {
    errors.quantity = "La correccion no puede descontar mas stock del disponible en la ubicacion.";
  } else if (dto.movementKind === "count" && dto.quantity === stock.quantity) {
    errors.quantity = "La existencia ya coincide con el conteo ingresado.";
  }
  if (!dto.reason.trim()) errors.reason = "El motivo es requerido.";
  else if (dto.reason.length > TEXT_LIMITS.reason)
    errors.reason = "El motivo admite hasta 200 caracteres.";
  if ((dto.notes?.length ?? 0) > TEXT_LIMITS.notes)
    errors.notes = "Las observaciones admiten hasta 500 caracteres.";
  if ((dto.lotNumber?.length ?? 0) > TEXT_LIMITS.lotNumber)
    errors.lotNumber = "El lote admite hasta 50 caracteres.";
  const delta =
    dto.movementKind === "count"
      ? dto.quantity - stock.quantity
      : dto.movementKind === "in"
        ? dto.quantity
        : -dto.quantity;
  const isEntry = delta > 0;
  const required = Math.abs(delta);
  if (row.tracking.lot && required > 0) {
    if (isEntry && !dto.lotNumber?.trim()) errors.lotNumber = "Ingresa el lote.";
    if (!isEntry && !dto.lotId) errors.lotId = "Selecciona el lote existente que sale.";
  }
  if (row.tracking.expiration && isEntry && required > 0 && !dto.expirationDate) {
    errors.expirationDate = "Ingresa la fecha de vencimiento.";
  } else if (
    row.tracking.expiration &&
    isEntry &&
    required > 0 &&
    dto.expirationDate &&
    isExpirationBeforeOperationDate(dto.expirationDate, operationDate)
  ) {
    errors.expirationDate = EXPIRATION_BEFORE_ENTRY_MESSAGE;
  }
  if (row.tracking.serial && required > 0) {
    const serials = dto.serialNumbers ?? [];
    if (serials.length !== required || new Set(serials).size !== serials.length) {
      errors.serialNumbers = `Registra exactamente ${required} series unicas.`;
    }
  }
  return errors;
}

export function validateTransfer(
  dto: TransferRequestDto,
  row: InventoryProductRow,
  providerStocks: ReadonlyArray<
    Pick<BranchStockSummary, "branchId" | "availableQuantity">
  > = row.otherBranchStocks,
): TransferValidationErrors {
  const errors: TransferValidationErrors = {};
  if (!dto.providerBranchId) {
    errors.providerBranchId = "Selecciona una sucursal.";
  } else if (dto.providerBranchId === dto.requesterBranchId) {
    errors.providerBranchId = "La sucursal debe ser diferente.";
  }
  const providerStock =
    providerStocks.find((stock) => stock.branchId === dto.providerBranchId)
      ?.availableQuantity ?? 0;
  if (!Number.isFinite(dto.quantity) || dto.quantity <= 0) {
    errors.quantity = "La cantidad debe ser mayor que cero.";
  } else if (dto.quantity > MAX_SAFE_INVENTORY_QUANTITY) {
    errors.quantity = "La cantidad no puede superar 999,999.99.";
  } else if (!isQuantityCompatibleWithUnit(dto.quantity, row.unitAllowsDecimals)) {
    errors.quantity = row.unitAllowsDecimals
      ? "La cantidad admite hasta 3 decimales."
      : "La unidad del producto no admite fracciones.";
  } else if (dto.quantity > providerStock) {
    errors.quantity = "La cantidad excede la existencia conocida de la sucursal.";
  }
  if (!dto.reason.trim()) errors.reason = "El motivo del traslado es requerido.";
  if ((dto.notes?.length ?? 0) > TEXT_LIMITS.notes)
    errors.notes = "Las observaciones admiten hasta 500 caracteres.";
  return errors;
}

export function hasValidationErrors<T extends object>(errors: T) {
  return Object.values(errors).some(Boolean);
}
