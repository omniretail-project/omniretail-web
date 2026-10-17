import type { CashShiftStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface CashShift {
  id: string;
  tenantId: string;
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
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
