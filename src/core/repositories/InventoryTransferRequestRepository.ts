import type { InventoryTransferRequest } from "@/core/entities";
import type { InventoryTransferReason, InventoryTransferRequestStatus } from "@/core/enums";

export interface InventoryTransferRequestFilters {
  tenantId?: string;
  requestingBranchId?: string;
  sourceBranchId?: string;
  status?: InventoryTransferRequestStatus;
}

export interface CreateInventoryTransferRequestInput {
  tenantId: string;
  requestingBranchId: string;
  sourceBranchId: string;
  productId: string;
  requestedQuantity: number;
  reason: InventoryTransferReason;
  notes?: string;
  requestedByUserId?: string;
}

export interface ReviewInventoryTransferRequestInput {
  reviewedByUserId?: string;
  /** Identidad idempotente para aprobar la solicitud y crear su traslado. */
  operationId?: string;
}

export interface ReceiveInventoryTransferRequestInput {
  receivedQuantity?: number;
}

export interface InventoryTransferRequestRepository {
  getById(id: string): Promise<InventoryTransferRequest | null>;
  getRequests(filters?: InventoryTransferRequestFilters): Promise<InventoryTransferRequest[]>;
  createRequest(input: CreateInventoryTransferRequestInput): Promise<InventoryTransferRequest>;
  approveRequest(
    id: string,
    input?: ReviewInventoryTransferRequestInput,
  ): Promise<InventoryTransferRequest>;
  rejectRequest(
    id: string,
    rejectionReason: string,
    input?: ReviewInventoryTransferRequestInput,
  ): Promise<InventoryTransferRequest>;
  markInTransit(id: string): Promise<InventoryTransferRequest>;
  markReceived(
    id: string,
    input?: ReceiveInventoryTransferRequestInput,
  ): Promise<InventoryTransferRequest>;
  cancelRequest(id: string, reason?: string): Promise<InventoryTransferRequest>;
}
