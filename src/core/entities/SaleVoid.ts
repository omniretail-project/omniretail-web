import type { ISODateString } from "@/core/types/common.types";

export interface SaleVoid {
  id: string;
  tenantId: string;
  branchId: string;
  saleId: string;
  reason: string;
  createdByUserId: string;
  createdAt: ISODateString;
  idempotencyKey: string;
  operationFingerprint: string;
  refundTotal: number;
}
