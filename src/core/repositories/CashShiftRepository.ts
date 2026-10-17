import type { CashShift } from "@/core/entities";

export interface OpenCashShiftInput {
  tenantId: string;
  branchId: string;
  userId: string;
  registerCode: string;
  openingAmount: number;
}

export interface CloseCashShiftInput {
  tenantId: string;
  cashShiftId: string;
  countedAmount: number;
  closedByUserId: string;
}

export interface CashShiftRepository {
  listByTenant(tenantId: string): Promise<CashShift[]>;
  getById(tenantId: string, cashShiftId: string): Promise<CashShift | null>;
  getOpenByUser(tenantId: string, userId: string): Promise<CashShift | null>;
  getOpenByUserAndBranch(
    tenantId: string,
    userId: string,
    branchId: string,
  ): Promise<CashShift | null>;
  open(input: OpenCashShiftInput): Promise<CashShift>;
  close(input: CloseCashShiftInput): Promise<CashShift>;
}
