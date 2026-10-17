import type { CashMovement } from "@/core/entities";
import { CashMovementType } from "@/core/enums";

export interface CashShiftTotals {
  openingAmount: number;
  cashSalesAmount: number;
  manualCashIn: number;
  manualCashOut: number;
  expectedCash: number;
  movementCount: number;
  saleCount: number;
}

export function calculateCashShiftTotals(
  openingAmount: number,
  movements: readonly CashMovement[],
): CashShiftTotals {
  assertNonNegativeMoney(openingAmount, "openingAmount");

  let cashSalesCents = 0;
  let manualCashInCents = 0;
  let manualCashOutCents = 0;
  const saleIds = new Set<string>();

  for (const movement of movements) {
    assertNonNegativeMoney(movement.amount, "CashMovement.amount");
    const amountCents = toCents(movement.amount);
    const isSaleCashIn = movement.type === CashMovementType.in && movement.referenceType === "sale";

    if (isSaleCashIn) {
      cashSalesCents = addCents(cashSalesCents, amountCents);
      if (movement.referenceId) saleIds.add(movement.referenceId);
    } else if (movement.type === CashMovementType.in) {
      manualCashInCents = addCents(manualCashInCents, amountCents);
    } else if (movement.type === CashMovementType.out) {
      manualCashOutCents = addCents(manualCashOutCents, amountCents);
    } else {
      throw new Error(`CashMovement type is invalid: ${String(movement.type)}`);
    }
  }

  const openingCents = toCents(openingAmount);
  const expectedCashCents = addCents(
    addCents(addCents(openingCents, cashSalesCents), manualCashInCents),
    -manualCashOutCents,
  );
  return {
    openingAmount: fromCents(openingCents),
    cashSalesAmount: fromCents(cashSalesCents),
    manualCashIn: fromCents(manualCashInCents),
    manualCashOut: fromCents(manualCashOutCents),
    expectedCash: fromCents(expectedCashCents),
    movementCount: movements.length,
    saleCount: saleIds.size,
  };
}

export function normalizeMoney(value: number): number {
  assertNonNegativeMoney(value, "amount");
  return roundMoney(value);
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Money value must be finite.");
  return fromCents(toCents(value));
}

function assertNonNegativeMoney(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite, non-negative amount.`);
  }
}

function toCents(value: number): number {
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("Money value exceeds safe precision.");
  return cents;
}

function fromCents(value: number): number {
  return value / 100;
}

function addCents(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error("Money total exceeds safe precision.");
  return total;
}
