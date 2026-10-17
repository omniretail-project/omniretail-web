import type { CashShift } from "@/core/entities";
import type { PosApiCashShift } from "@/core/repositories";
import type { PosCashShiftDto } from "@/modules/pos/application/dto/PosCashShiftDto";

export function toPosCashShiftDto(shift: CashShift | PosApiCashShift): PosCashShiftDto {
  return {
    id: shift.id,
    branchId: shift.branchId,
    userId: shift.userId,
    registerCode: shift.registerCode,
    status: shift.status,
    openedAt: shift.openedAt,
    openingAmount: shift.openingAmount,
    closedAt: shift.closedAt,
    expectedAmount: shift.expectedAmount,
    countedAmount: shift.countedAmount,
    difference: shift.difference,
  };
}
