import type { ReturnStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface ReturnRequest {
  id: string;
  tenantId: string;
  branchId: string;
  saleId: string;
  status: ReturnStatus;
  reason: string;
  createdByUserId: string;
  processedByUserId?: string;
  createdAt: ISODateString;
  processedAt?: ISODateString;
  updatedAt: ISODateString;
  idempotencyKey: string;
  operationFingerprint: string;
  refundTotal: number;
  lines: ReturnLine[];
}

export interface ReturnLine {
  id: string;
  returnId: string;
  saleItemId: string;
  productId: string;
  quantity: number;
  amount: number;
}
