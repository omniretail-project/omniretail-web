import type { CashShiftStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface PosCashShiftDto {
  id: string;
  branchId: string;
  userId: string;
  registerCode: string;
  status: CashShiftStatus;
  openedAt: ISODateString;
  openingAmount: number;
  closedAt?: ISODateString;
  expectedAmount?: number;
  countedAmount?: number;
  difference?: number;
}
