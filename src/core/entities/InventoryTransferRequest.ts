import type { InventoryTransferReason, InventoryTransferRequestStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface InventoryTransferRequest {
  id: string;
  tenantId: string;
  requestingBranchId: string;
  sourceBranchId: string;
  productId: string;
  requestedQuantity: number;
  receivedQuantity?: number;
  reason: InventoryTransferReason;
  notes?: string;
  status: InventoryTransferRequestStatus;
  rejectionReason?: string;
  cancellationReason?: string;
  requestedAt: ISODateString;
  reviewedAt?: ISODateString;
  approvedAt?: ISODateString;
  rejectedAt?: ISODateString;
  dispatchedAt?: ISODateString;
  receivedAt?: ISODateString;
  cancelledAt?: ISODateString;
  requestedByUserId?: string;
  reviewedByUserId?: string;
  /** Transfer generado por la aprobación cuando la solicitud ya entró al ciclo logístico. */
  transferId?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
