import type { CashMovementType } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface CashMovement {
  id: string;
  cashShiftId: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  createdByUserId: string;
  createdAt: ISODateString;
}
