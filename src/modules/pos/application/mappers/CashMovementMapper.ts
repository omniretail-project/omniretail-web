import type { CashMovement } from "@/core/entities";
import type { CashMovementDto } from "@/modules/pos/application/dto/CashMovementDto";

export function toCashMovementDto(movement: CashMovement): CashMovementDto {
  return {
    id: movement.id,
    cashShiftId: movement.cashShiftId,
    type: movement.type,
    amount: movement.amount,
    reason: movement.reason,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    createdByUserId: movement.createdByUserId,
    createdAt: movement.createdAt,
  };
}
