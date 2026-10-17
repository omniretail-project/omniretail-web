import { InventoryTransferRequestStatus } from "@/core/enums";
import type { InventoryTransferRequest } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import { GetInventoryTransferHistoryService, type TransferHistoryRow } from "@/modules/inventory/application/services/GetInventoryTransferHistoryService";
import {
  ensureCanReadStock,
  ensureProductBelongsToTenant,
  ensureUserCanOperateInventoryBranch,
  INVENTORY_TRANSFERS_MANAGE_PERMISSION,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";

export interface ProductTransferRequestRow {
  id: string;
  sourceBranchName: string;
  destinationBranchName: string;
  requestedQuantity: number;
  reason: InventoryTransferRequest["reason"];
  notes?: string;
  status: InventoryTransferRequestStatus;
  requestedAt: string;
  updatedAt: string;
  rejectionReason?: string;
  cancellationReason?: string;
  linkedTransferId?: string;
  linkedTransferNumber?: string;
  canCancel: boolean;
  canReview: boolean;
}

export interface InventoryProductTransfersReadModel {
  requests: ProductTransferRequestRow[];
  transfers: TransferHistoryRow[];
}

/** Product-specific view; authority is checked before either branch-scoped query runs. */
export class GetInventoryProductTransfersService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(branchId: string, productId: string): Promise<InventoryProductTransfersReadModel> {
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, branchId);
    ensureProductBelongsToTenant(await this.repositories.products.getById(productId), tenantId);
    const [requested, provided, transfers, branches, session] = await Promise.all([
      this.repositories.inventoryTransferRequests.getRequests({ tenantId, requestingBranchId: branchId }),
      this.repositories.inventoryTransferRequests.getRequests({ tenantId, sourceBranchId: branchId }),
      new GetInventoryTransferHistoryService(this.repositories).execute(branchId, productId),
      this.repositories.branches.getAll(),
      resolveCurrentSessionSnapshot(this.repositories),
    ]);
    const activeBranchId = session.sessionId
      ? (await this.repositories.auth.getSession(session.sessionId))?.activeBranchId
      : undefined;
    const canManage = permissions.includes(INVENTORY_TRANSFERS_MANAGE_PERMISSION);
    const names = new Map(branches.filter((branch) => branch.tenantId === tenantId)
      .map((branch) => [branch.id, branch.name]));
    const linked = new Map(transfers.flatMap((transfer) => transfer.sourceRequestIds
      .map((requestId) => [requestId, transfer] as const)));
    const requests = [...new Map([...requested, ...provided]
      .filter((request) => request.productId === productId)
      .map((request) => [request.id, request])).values()];
    return {
      requests: requests.map((request): ProductTransferRequestRow => {
        const transfer = linked.get(request.id);
        const pending = request.status === InventoryTransferRequestStatus.requested && !transfer;
        return {
          id: request.id,
          sourceBranchName: names.get(request.sourceBranchId) ?? "Sucursal proveedora",
          destinationBranchName: names.get(request.requestingBranchId) ?? "Sucursal solicitante",
          requestedQuantity: request.requestedQuantity,
          reason: request.reason,
          notes: request.notes,
          status: request.status,
          requestedAt: request.requestedAt,
          updatedAt: request.updatedAt,
          rejectionReason: request.rejectionReason,
          cancellationReason: request.cancellationReason,
          linkedTransferId: transfer?.id,
          linkedTransferNumber: transfer?.number,
          canCancel: canManage && pending && branchId === request.requestingBranchId &&
            activeBranchId === request.requestingBranchId,
          canReview: canManage && pending && branchId === request.sourceBranchId &&
            activeBranchId === request.sourceBranchId,
        };
      }).sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)),
      transfers,
    };
  }
}
