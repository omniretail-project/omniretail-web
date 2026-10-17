import type { ReceiptStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface Receipt {
  id: string;
  tenantId: string;
  branchId: string;
  number: string;
  purchaseOrderId?: string;
  inventoryTransferId?: string;
  supplierId?: string;
  status: ReceiptStatus;
  /** Stable idempotency identity for a completed receiving confirmation. */
  confirmationId?: string;
  confirmationFingerprint?: string;
  receivedByUserId?: string;
  receivedAt?: ISODateString;
  notes?: string;
  /** Agregados del listado API (GoodsReceiptResponse); ausentes en modo mock/backends antiguos. */
  totalReceivedQuantity?: number;
  incidentCount?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
