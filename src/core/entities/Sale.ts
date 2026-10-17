import type { SaleStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";
import type { SaleItem } from "@/core/entities/SaleItem";

export type SaleDocumentType = "ticket" | "invoice";

export interface SaleDocumentSnapshot {
  type: SaleDocumentType;
  taxId?: string;
  legalName?: string;
  fiscalAddress?: string;
}

export interface Sale {
  id: string;
  tenantId: string;
  branchId: string;
  number: string;
  customerId?: string;
  sourceOrderId?: string;
  confirmationId?: string;
  confirmationFingerprint?: string;
  cashShiftId: string;
  items: SaleItem[];
  status: SaleStatus;
  document?: SaleDocumentSnapshot;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  createdByUserId: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
