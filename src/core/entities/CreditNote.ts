import type { ISODateString } from "@/core/types/common.types";

export interface CreditNote {
  id: string;
  tenantId: string;
  branchId: string;
  saleId: string;
  returnId?: string;
  voidId?: string;
  documentNumber: string;
  originalDocumentNumber: string;
  amount: number;
  reason: string;
  createdAt: ISODateString;
  createdByUserId: string;
}
