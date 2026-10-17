import type { CashShift } from "@/core/entities";
import type { CashShiftDto } from "@/modules/administration/application/dto/CashShiftDto";

export function toCashShiftDto(shift: CashShift): CashShiftDto {
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
    createdAt: shift.createdAt,
    updatedAt: shift.updatedAt,
  };
}
