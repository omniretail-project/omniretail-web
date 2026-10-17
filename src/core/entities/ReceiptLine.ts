import type { ReceiptLineStatus } from "@/core/enums";

export interface ReceiptLine {
  id: string;
  receiptId: string;
  productId: string;
  orderedQuantity?: number;
  receivedQuantity: number;
  /** Base-unit quantity applied to inventory; receipt quantities remain in purchase units. */
  inventoryQuantity?: number;
  rejectedQuantity?: number;
  status: ReceiptLineStatus;
  locationId?: string;
  lotId?: string;
  lotNumber?: string;
  expirationDate?: string;
  serialNumbers?: string[];
  notes?: string;
}
