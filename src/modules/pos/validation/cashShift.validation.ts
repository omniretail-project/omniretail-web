import type { CashMovementType } from "@/core/enums";

export interface CashShiftFormErrors {
  registerCode?: string;
  amount?: string;
  reason?: string;
}

export function validateOpenCashShift(registerCode: string, openingAmount: number) {
  const errors: CashShiftFormErrors = {};
  if (!registerCode.trim()) errors.registerCode = "Ingresa el código de caja.";
  validateMoney(openingAmount, "El monto inicial", true, errors);
  return errors;
}

export function validateCashMovement(type: CashMovementType, amount: number, reason: string) {
  const errors: CashShiftFormErrors = {};
  if (type !== "in" && type !== "out") errors.amount = "Selecciona un tipo válido.";
  validateMoney(amount, "El monto", false, errors);
  if (!reason.trim()) errors.reason = "Ingresa el motivo del movimiento.";
  return errors;
}

export function validateCashCount(countedAmount: number) {
  const errors: CashShiftFormErrors = {};
  validateMoney(countedAmount, "El efectivo contado", true, errors);
  return errors;
}

export function hasCashShiftFormErrors(errors: CashShiftFormErrors) {
  return Object.values(errors).some(Boolean);
}

function validateMoney(
  value: number,
  label: string,
  allowZero: boolean,
  errors: CashShiftFormErrors,
) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    errors.amount = `${label} debe ser ${allowZero ? "cero o mayor" : "mayor que cero"}.`;
  }
}
