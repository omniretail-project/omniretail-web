import type { CashShift } from "@/core/entities";

export type CashShiftDto = Omit<CashShift, "tenantId">;

export interface CashShiftFilter {
  search?: string;
  status?: string;
  branchId?: string;
  from?: string;
  to?: string;
}
