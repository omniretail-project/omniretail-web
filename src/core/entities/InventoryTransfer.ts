import type { InventoryTransferReason, InventoryTransferStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface InventoryTransfer {
  id: string;
  tenantId: string;
  number: string;
  sourceBranchId: string;
  destinationBranchId: string;
  status: InventoryTransferStatus;
  /** Stable identity of the creation command; retries must not create another transfer. */
  operationId?: string;
  operationFingerprint?: string;
  sourceRequestIds?: string[];
  reason?: InventoryTransferReason;
  notes?: string;
  preparedByUserId?: string;
  dispatchedByUserId?: string;
  receivedByUserId?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  dispatchedAt?: ISODateString;
  receivedAt?: ISODateString;
  cancelledAt?: ISODateString;
  cancelledByUserId?: string;
  cancelOperationId?: string;
  cancelFingerprint?: string;
}
