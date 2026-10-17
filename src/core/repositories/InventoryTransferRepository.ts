import type { InventoryTransfer, InventoryTransferItem } from "@/core/entities";
import type { InventoryTransferReason, InventoryTransferStatus } from "@/core/enums";

export interface InventoryTransferFilters {
  tenantId?: string;
  sourceBranchId?: string;
  destinationBranchId?: string;
  status?: InventoryTransferStatus;
}

export interface CreateInventoryTransferItemInput {
  productId: string;
  sourceRequestId?: string;
  requestedQuantity: number;
  dispatchedQuantity?: number;
  receivedQuantity?: number;
}

export interface CreateInventoryTransferInput {
  tenantId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  operationId: string;
  sourceRequestIds?: string[];
  /** Approve this persisted request in the same transaction as Transfer, reservation and Picking. */
  approveSourceRequest?: { requestId: string; reviewedByUserId: string };
  reason?: InventoryTransferReason;
  notes?: string;
  preparedByUserId: string;
  items: CreateInventoryTransferItemInput[];
}

export interface DispatchInventoryTransferItemInput {
  itemId: string;
  dispatchedQuantity: number;
}

export interface DispatchInventoryTransferInput {
  dispatchedByUserId: string;
  operationId: string;
  items: DispatchInventoryTransferItemInput[];
}

export interface ReceiveInventoryTransferItemInput {
  itemId: string;
  /** Quantity accepted in this confirmation, not the cumulative received quantity. */
  receivedQuantity: number;
  locationId: string;
  /** Semantic identity of the dispatched source lot; required for lot-tracked products. */
  lotNumber?: string;
  expirationDate?: string;
  /** Exact dispatched serials physically received in this confirmation. */
  serialNumbers?: string[];
}

export interface ReceiveInventoryTransferInput {
  receivedByUserId: string;
  confirmationId: string;
  items: ReceiveInventoryTransferItemInput[];
}

export interface InventoryTransferWithItems {
  transfer: InventoryTransfer;
  items: InventoryTransferItem[];
}

export interface InventoryTransferRepository {
  getById(id: string): Promise<InventoryTransferWithItems | null>;
  getByNumber(tenantId: string, number: string): Promise<InventoryTransferWithItems | null>;
  query(filters?: InventoryTransferFilters): Promise<InventoryTransferWithItems[]>;
  create(input: CreateInventoryTransferInput): Promise<InventoryTransferWithItems>;
  markInTransit(
    id: string,
    input: DispatchInventoryTransferInput,
  ): Promise<InventoryTransferWithItems>;
  markReceived(
    id: string,
    input: ReceiveInventoryTransferInput,
  ): Promise<InventoryTransferWithItems>;
  cancel(id: string, input: {
    reason: string;
    actorUserId: string;
    operationId: string;
  }): Promise<InventoryTransferWithItems>;
}
