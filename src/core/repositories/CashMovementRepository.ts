import type { CashMovement } from "@/core/entities";
import type { CashMovementType } from "@/core/enums";

export interface RegisterCashMovementInput {
  tenantId: string;
  cashShiftId: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  createdByUserId: string;
}

export interface CashMovementRepository {
  listByCashShift(tenantId: string, cashShiftId: string): Promise<CashMovement[]>;
  register(input: RegisterCashMovementInput): Promise<CashMovement>;
}
