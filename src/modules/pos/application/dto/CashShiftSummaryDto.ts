import type { CashShiftStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface CashShiftSummaryDto {
  cashShiftId: string;
  status: CashShiftStatus;
  openedAt: ISODateString;
  openingAmount: number;
  cashSalesAmount: number;
  manualCashIn: number;
  manualCashOut: number;
  expectedCash: number;
  movementCount: number;
  saleCount: number;
}
