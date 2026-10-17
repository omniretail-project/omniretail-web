import type { PurchaseOrderStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";
import type { PurchaseOrderItem } from "@/core/entities/PurchaseOrderItem";

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  branchId: string;
  number: string;
  supplierId: string;
  /** Historical supplier name returned by the purchasing API. */
  supplierNameSnapshot?: string;
  status: PurchaseOrderStatus;
  expectedDate?: ISODateString;
  notes?: string;
  subtotal: number;
  total: number;
  createdByUserId: string;
  approvedByUserId?: string;
  approvedAt?: ISODateString;
  cancellationReason?: string;
  cancelledByUserId?: string;
  cancelledAt?: ISODateString;
  items?: PurchaseOrderItem[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
