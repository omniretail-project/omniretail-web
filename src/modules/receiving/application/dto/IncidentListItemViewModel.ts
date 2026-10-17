import type { ReceiptIncidentApiStatus, ReceiptIncidentEvidence } from "@/core/entities";

export interface IncidentListItemViewModel {
  id: string;
  receiptId: string;
  receiptNumber: string;
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  productName: string;
  sku: string;
  supplierId?: string;
  supplierName?: string;
  branchName?: string;
  typeName: string;
  quantityAffected?: number;
  observation: string;
  date: string;
  responsibleName?: string;
  evidence: ReceiptIncidentEvidence[];
  status?: ReceiptIncidentApiStatus;
  confirmed: boolean;
}
