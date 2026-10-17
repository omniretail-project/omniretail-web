import { normalizeMoney } from "@/core/cash/cashShiftTotals";
import type { CashMovement, CashShift } from "@/core/entities";
import { CashMovementType, CashShiftStatus, UserStatus, UserType } from "@/core/enums";
import type { RegisterCashMovementInput } from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";

export interface RegisterCashMovementInTransactionOptions {
  createId: (prefix: string) => string;
  now: () => string;
}

export interface RegisteredCashMovement {
  movement: CashMovement;
  shift: CashShift;
}

/**
 * Canonical mock write for a CashMovement. Callers that already own a
 * MockDatabaseStore transaction pass its draft so all related writes commit together.
 */
export function registerCashMovementInTransaction(
  db: MockDatabase,
  input: RegisterCashMovementInput,
  options: RegisterCashMovementInTransactionOptions,
): RegisteredCashMovement {
  const shift = db.cashShifts.find(
    (candidate) => candidate.id === input.cashShiftId && candidate.tenantId === input.tenantId,
  );
  if (!shift) throw new Error(`CashShift not found: ${input.cashShiftId}`);
  if (shift.status !== CashShiftStatus.open) {
    throw new Error("Cash movements require an open cash shift.");
  }
  const branch = db.branches.find(
    (candidate) => candidate.id === shift.branchId && candidate.tenantId === input.tenantId,
  );
  if (!branch) throw new Error("CashShift branch is not valid for tenant.");
  const actor = db.users.find(
    (candidate) => candidate.id === input.createdByUserId && candidate.tenantId === input.tenantId,
  );
  if (
    !actor ||
    actor.type !== UserType.employee ||
    actor.status !== UserStatus.active ||
    actor.id !== shift.userId
  ) {
    throw new Error("Cash movement actor is not the active user assigned to the shift.");
  }
  if (input.type !== CashMovementType.in && input.type !== CashMovementType.out) {
    throw new Error("Cash movement type is invalid.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new Error("Cash movement reason is required.");
  const referenceType = input.referenceType?.trim();
  const referenceId = input.referenceId?.trim();
  if (Boolean(referenceType) !== Boolean(referenceId)) {
    throw new Error("Cash movement references require both referenceType and referenceId.");
  }
  const amount = normalizeMoney(input.amount);
  if (amount === 0) throw new Error("Cash movement amount must be greater than zero.");

  const movement: CashMovement = {
    id: options.createId("cash-movement"),
    cashShiftId: shift.id,
    type: input.type,
    amount,
    reason,
    referenceType,
    referenceId,
    createdByUserId: actor.id,
    createdAt: options.now(),
  };
  db.cashMovements.push(movement);
  return { movement, shift };
}
