import type { PaymentMethod } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface RefundTransaction {
  id: string;
  tenantId: string;
  branchId: string;
  saleId: string;
  returnId?: string;
  voidId?: string;
  paymentId: string;
  method: Exclude<PaymentMethod, "mixed">;
  amount: number;
  createdByUserId: string;
  createdAt: ISODateString;
}
