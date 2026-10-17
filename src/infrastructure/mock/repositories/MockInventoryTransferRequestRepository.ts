import { InventoryTransferRequestStatus } from "@/core/enums";
import type { InventoryTransferRequest, Product } from "@/core/entities";
import type {
  CreateInventoryTransferRequestInput,
  InventoryTransferRequestRepository,
  ReceiveInventoryTransferRequestInput,
  ReviewInventoryTransferRequestInput,
} from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockInventoryTransferRequestRepository
  extends BaseMockRepository
  implements InventoryTransferRequestRepository
{
  async getById(id: string) {
    return this.read((db) => db.inventoryTransferRequests.find((item) => item.id === id) ?? null);
  }

  async getRequests(
    filters: Parameters<InventoryTransferRequestRepository["getRequests"]>[0] = {},
  ) {
    return this.read((db) =>
      db.inventoryTransferRequests.filter(
        (item) =>
          (!filters.tenantId || item.tenantId === filters.tenantId) &&
          (!filters.requestingBranchId || item.requestingBranchId === filters.requestingBranchId) &&
          (!filters.sourceBranchId || item.sourceBranchId === filters.sourceBranchId) &&
          (!filters.status || item.status === filters.status),
      ),
    );
  }

  async createRequest(input: CreateInventoryTransferRequestInput) {
    const item = this.store.mutate((db) => {
      this.assertValidCreateInput(db, input);
      const now = this.now();
      const created: InventoryTransferRequest = {
        ...input,
        id: this.id("inventory-transfer-request"),
        status: InventoryTransferRequestStatus.requested,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      db.inventoryTransferRequests.push(created);
      return created;
    });
    this.emitChanged(item, "created");
    return item;
  }

  async approveRequest(id: string, input: ReviewInventoryTransferRequestInput = {}) {
    const item = this.store.mutate((db) => {
      const current = this.findRequest(db, id);
      this.assertStatus(current, [InventoryTransferRequestStatus.requested], "approve");
      const now = this.now();
      return this.replaceRequest(db, {
        ...current,
        status: InventoryTransferRequestStatus.approved,
        reviewedAt: now,
        approvedAt: now,
        reviewedByUserId: input.reviewedByUserId,
        updatedAt: now,
      });
    });
    this.emitChanged(item, "status_changed");
    return item;
  }

  async rejectRequest(
    id: string,
    rejectionReason: string,
    input: ReviewInventoryTransferRequestInput = {},
  ) {
    const item = this.store.mutate((db) => {
      if (!rejectionReason.trim()) {
        throw new Error("Inventory transfer request rejectionReason is required");
      }
      const current = this.findRequest(db, id);
      this.assertStatus(current, [InventoryTransferRequestStatus.requested], "reject");
      const now = this.now();
      return this.replaceRequest(db, {
        ...current,
        status: InventoryTransferRequestStatus.rejected,
        rejectionReason: rejectionReason.trim(),
        reviewedAt: now,
        rejectedAt: now,
        reviewedByUserId: input.reviewedByUserId,
        updatedAt: now,
      });
    });
    this.emitChanged(item, "status_changed");
    return item;
  }

  async markInTransit(id: string) {
    const item = this.store.mutate((db) => {
      const current = this.findRequest(db, id);
      this.assertStatus(current, [InventoryTransferRequestStatus.approved], "mark in transit");
      const now = this.now();
      return this.replaceRequest(db, {
        ...current,
        status: InventoryTransferRequestStatus.inTransit,
        dispatchedAt: now,
        updatedAt: now,
      });
    });
    this.emitChanged(item, "status_changed");
    return item;
  }

  async markReceived(id: string, input: ReceiveInventoryTransferRequestInput = {}) {
    const item = this.store.mutate((db) => {
      if (
        typeof input.receivedQuantity === "number" &&
        (!Number.isFinite(input.receivedQuantity) || input.receivedQuantity < 0)
      ) {
        throw new Error(
          "Inventory transfer request receivedQuantity must be greater than or equal to 0",
        );
      }
      const current = this.findRequest(db, id);
      this.assertStatus(current, [InventoryTransferRequestStatus.inTransit], "mark received");
      const now = this.now();
      return this.replaceRequest(db, {
        ...current,
        status: InventoryTransferRequestStatus.received,
        receivedQuantity: input.receivedQuantity,
        receivedAt: now,
        updatedAt: now,
      });
    });
    this.emitChanged(item, "status_changed");
    return item;
  }

  async cancelRequest(id: string, reason?: string) {
    const item = this.store.transact((db) => {
      const current = this.findRequest(db, id);
      this.assertStatus(current, [InventoryTransferRequestStatus.requested], "cancel");
      if (db.inventoryTransfers.some((transfer) => transfer.sourceRequestIds?.includes(id))) {
        throw new Error("Inventory transfer request already has a transfer");
      }
      const now = this.now();
      return this.replaceRequest(db, {
        ...current,
        status: InventoryTransferRequestStatus.cancelled,
        cancellationReason: reason?.trim() || undefined,
        cancelledAt: now,
        updatedAt: now,
      });
    });
    this.emitChanged(item, "status_changed");
    return item;
  }

  private assertValidCreateInput(
    db: MockDatabase,
    input: CreateInventoryTransferRequestInput,
  ): Product {
    if (input.requestingBranchId === input.sourceBranchId) {
      throw new Error("Inventory transfer request branches must be different");
    }
    if (!Number.isFinite(input.requestedQuantity) || input.requestedQuantity <= 0) {
      throw new Error("Inventory transfer request requestedQuantity must be greater than 0");
    }

    const product = db.products.find((item) => item.id === input.productId);
    if (!product) throw this.missing("Product", input.productId);
    if (product.tenantId !== input.tenantId) {
      throw new Error("Inventory transfer request tenant must match product tenant");
    }

    const requestingBranch = db.branches.find((item) => item.id === input.requestingBranchId);
    if (!requestingBranch) throw this.missing("Branch", input.requestingBranchId);
    if (requestingBranch.tenantId !== input.tenantId) {
      throw new Error("Inventory transfer request tenant must match requesting branch tenant");
    }

    const sourceBranch = db.branches.find((item) => item.id === input.sourceBranchId);
    if (!sourceBranch) throw this.missing("Branch", input.sourceBranchId);
    if (sourceBranch.tenantId !== input.tenantId) {
      throw new Error("Inventory transfer request tenant must match source branch tenant");
    }

    return product;
  }

  private findRequest(db: MockDatabase, id: string): InventoryTransferRequest {
    const item = db.inventoryTransferRequests.find((request) => request.id === id);
    if (!item) throw this.missing("InventoryTransferRequest", id);
    return item;
  }

  private replaceRequest(
    db: MockDatabase,
    request: InventoryTransferRequest,
  ): InventoryTransferRequest {
    const index = db.inventoryTransferRequests.findIndex((item) => item.id === request.id);
    if (index < 0) throw this.missing("InventoryTransferRequest", request.id);
    db.inventoryTransferRequests[index] = request;
    return request;
  }

  private assertStatus(
    request: InventoryTransferRequest,
    allowed: InventoryTransferRequestStatus[],
    action: string,
  ): void {
    if (!allowed.includes(request.status)) {
      throw new Error(`Cannot ${action} inventory transfer request from status ${request.status}`);
    }
  }

  private emitChanged(
    request: InventoryTransferRequest,
    action: "created" | "status_changed",
  ): void {
    this.emit("inventory-transfer-request.changed", {
      entityId: request.id,
      tenantId: request.tenantId,
      branchId: request.sourceBranchId,
      productId: request.productId,
      action,
      metadata: {
        requestingBranchId: request.requestingBranchId,
        sourceBranchId: request.sourceBranchId,
        status: request.status,
      },
    });
  }
}
