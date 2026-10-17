import {
  BranchStatus, DispatchStatus, InventoryMovementType, InventoryReservationStatus, InventoryTransferRequestStatus,
  InventoryTransferStatus, LocationStatus, PackingStatus, PickingIncidentStatus,
  PickingItemStatus, PickingPriority, PickingStatus, ProductType, ReceiptLineStatus,
  ReceiptStatus, SerialStatus, TransportMode, UserStatus, UserType,
} from "@/core/enums";
import type { InventoryTransfer, InventoryTransferItem } from "@/core/entities";
import type {
  CreateInventoryTransferInput,
  InventoryTransferRepository,
  InventoryTransferWithItems,
} from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { reserveOrderItemInDatabase } from "@/infrastructure/mock/repositories/inventoryReservationMutations";
import { commitPickedOrderInventoryInDatabase } from "@/infrastructure/mock/repositories/commitPickedOrderInventoryInDatabase";

export class MockInventoryTransferRepository
  extends BaseMockRepository
  implements InventoryTransferRepository
{
  async getById(id: string) {
    return this.read((db) => this.findTransferWithItems(db, id));
  }

  async getByNumber(tenantId: string, number: string) {
    return this.read((db) => {
      const transfer =
        db.inventoryTransfers.find(
          (item) => item.tenantId === tenantId && item.number === number,
        ) ?? null;
      return transfer ? this.toTransferWithItems(db, transfer) : null;
    });
  }

  async query(filters: Parameters<InventoryTransferRepository["query"]>[0] = {}) {
    return this.read((db) =>
      db.inventoryTransfers
        .filter(
          (item) =>
            (!filters.tenantId || item.tenantId === filters.tenantId) &&
            (!filters.sourceBranchId || item.sourceBranchId === filters.sourceBranchId) &&
            (!filters.destinationBranchId ||
              item.destinationBranchId === filters.destinationBranchId) &&
            (!filters.status || item.status === filters.status),
        )
        .map((transfer) => this.toTransferWithItems(db, transfer)),
    );
  }

  async create(input: CreateInventoryTransferInput) {
    const item = this.store.transact((db) => {
      const approval = input.approveSourceRequest;
      const sourceRequest = approval
        ? db.inventoryTransferRequests.find((entry) => entry.id === approval.requestId)
        : undefined;
      if (approval) {
        if (!sourceRequest || sourceRequest.tenantId !== input.tenantId ||
          sourceRequest.sourceBranchId !== input.sourceBranchId ||
          sourceRequest.requestingBranchId !== input.destinationBranchId ||
          input.sourceRequestIds?.length !== 1 ||
          input.sourceRequestIds[0] !== approval.requestId ||
          input.items.length !== 1 ||
          input.items[0].sourceRequestId !== approval.requestId ||
          input.items[0].productId !== sourceRequest.productId ||
          input.items[0].requestedQuantity !== sourceRequest.requestedQuantity ||
          approval.reviewedByUserId !== input.preparedByUserId) {
          throw new Error("Transfer source request does not match the persisted request");
        }
        const linked = db.inventoryTransfers.filter((entry) =>
          entry.sourceRequestIds?.includes(approval.requestId));
        if (linked.length > 1) throw new Error("Transfer source request is linked more than once");
        if (linked.length === 1) {
          const linkedItems = db.inventoryTransferItems.filter((entry) =>
            entry.transferId === linked[0].id);
          const picking = db.pickingOrders.filter((entry) =>
            entry.sourceType === "transfer" && entry.sourceId === linked[0].id);
          const reservations = db.inventoryReservations.filter((entry) =>
            entry.sourceType === "transfer" && entry.sourceId === linked[0].id);
          if (sourceRequest.status !== InventoryTransferRequestStatus.approved ||
            linked[0].tenantId !== input.tenantId ||
            linked[0].sourceBranchId !== input.sourceBranchId ||
            linked[0].destinationBranchId !== input.destinationBranchId ||
            linkedItems.length !== 1 || linkedItems[0].sourceRequestId !== approval.requestId ||
            linkedItems[0].productId !== sourceRequest.productId ||
            linkedItems[0].requestedQuantity !== sourceRequest.requestedQuantity ||
            picking.length !== 1 || reservations.length !== 1) {
            throw new Error("Transfer source request has incomplete fulfillment");
          }
          return { ...this.toTransferWithItems(db, linked[0]), created: false,
            approvedRequest: undefined };
        }
        if (![InventoryTransferRequestStatus.requested,
          InventoryTransferRequestStatus.approved].includes(sourceRequest.status)) {
          throw new Error("Transfer source request is not reviewable");
        }
        if (db.inventoryTransfers.some((entry) =>
          entry.tenantId === input.tenantId && entry.operationId === input.operationId)) {
          throw new Error(`Transfer operation conflict: ${input.operationId}`);
        }
      }
      const approvedRequest = sourceRequest?.status === InventoryTransferRequestStatus.requested
        ? sourceRequest : undefined;
      if (approvedRequest && approval) {
        const now = this.now();
        approvedRequest.status = InventoryTransferRequestStatus.approved;
        approvedRequest.reviewedAt = now;
        approvedRequest.approvedAt = now;
        approvedRequest.reviewedByUserId = approval.reviewedByUserId;
        approvedRequest.updatedAt = now;
      }
      this.assertValidCreateInput(db, input);
      const fingerprint = JSON.stringify({
        tenantId: input.tenantId, sourceBranchId: input.sourceBranchId,
        destinationBranchId: input.destinationBranchId,
        items: input.items.map((entry) => ({ productId: entry.productId,
          requestedQuantity: entry.requestedQuantity, sourceRequestId: entry.sourceRequestId ?? null })),
        notes: input.notes?.trim() || null,
        reason: input.reason ?? null,
      });
      const existing = db.inventoryTransfers.find((entry) =>
        entry.tenantId === input.tenantId && entry.operationId === input.operationId);
      if (existing) {
        if (existing.operationFingerprint !== fingerprint) {
          throw new Error(`Transfer operation conflict: ${input.operationId}`);
        }
        const picking = db.pickingOrders.filter((entry) =>
          entry.sourceType === "transfer" && entry.sourceId === existing.id);
        if (picking.length !== 1) throw new Error(`Transfer Picking conflict: ${existing.id}`);
        return { ...this.toTransferWithItems(db, existing), created: false,
          approvedRequest: undefined };
      }
      const now = this.now();
      const sourceRequestIds = this.getTransferSourceRequestIds(input);
      if (sourceRequestIds.some((requestId) => db.inventoryTransfers.some((entry) =>
        entry.sourceRequestIds?.includes(requestId)))) {
        throw new Error("Transfer source request is already linked");
      }
      const transfer: InventoryTransfer = {
        id: this.id("inventory-transfer"),
        tenantId: input.tenantId,
        number: this.generateTransferNumber(db, input.tenantId, now),
        sourceBranchId: input.sourceBranchId,
        destinationBranchId: input.destinationBranchId,
        status: InventoryTransferStatus.preparing,
        operationId: input.operationId,
        operationFingerprint: fingerprint,
        sourceRequestIds: sourceRequestIds.length ? sourceRequestIds : undefined,
        reason: input.reason,
        notes: input.notes?.trim() || undefined,
        preparedByUserId: input.preparedByUserId,
        createdAt: now,
        updatedAt: now,
      };
      const items = input.items.map<InventoryTransferItem>((transferItem) => ({
        id: this.id("inventory-transfer-item"),
        transferId: transfer.id,
        productId: transferItem.productId,
        sourceRequestId: transferItem.sourceRequestId,
        requestedQuantity: transferItem.requestedQuantity,
        dispatchedQuantity: transferItem.dispatchedQuantity ?? 0,
        receivedQuantity: transferItem.receivedQuantity ?? 0,
      }));
      db.inventoryTransfers.push(transfer);
      db.inventoryTransferItems.push(...items);
      const pickingId = this.id("picking");
      db.pickingOrders.push({
        id: pickingId, tenantId: input.tenantId, branchId: input.sourceBranchId,
        sourceType: "transfer", sourceId: transfer.id,
        status: PickingStatus.pending, priority: PickingPriority.normal,
        createdAt: now, updatedAt: now,
      });
      for (const transferItem of items) {
        const reservation = reserveOrderItemInDatabase(db, {
          tenantId: input.tenantId, branchId: input.sourceBranchId,
          orderItemId: transferItem.id,
          sourceType: "transfer", sourceId: transfer.id,
          productId: transferItem.productId, quantity: transferItem.requestedQuantity,
        }, { id: (prefix) => this.id(prefix), now: () => now }).reservation;
        db.pickingItems.push({
          id: this.id("picking-item"), pickingOrderId: pickingId,
          orderItemId: transferItem.id, productId: transferItem.productId,
          requestedQuantity: transferItem.requestedQuantity, pickedQuantity: 0,
          locationId: reservation.allocations[0]?.locationId,
          status: PickingItemStatus.pending,
        });
      }
      return { transfer, items, created: true, approvedRequest };
    });
    if (item.created) {
      if (item.approvedRequest) {
        try { this.emit("inventory-transfer-request.changed", {
          entityId: item.approvedRequest.id, tenantId: item.approvedRequest.tenantId,
          branchId: item.approvedRequest.sourceBranchId,
          productId: item.approvedRequest.productId, action: "status_changed",
          metadata: { requestingBranchId: item.approvedRequest.requestingBranchId,
            sourceBranchId: item.approvedRequest.sourceBranchId,
            status: item.approvedRequest.status },
        }); } catch { /* Authoritative commit already succeeded. */ }
      }
      this.emitChanged(item.transfer, "created");
      const picking = this.read((db) => db.pickingOrders.find((entry) =>
        entry.sourceType === "transfer" && entry.sourceId === item.transfer.id));
      if (picking) this.emitPickingChanged(picking, "created");
      this.emitStockChanged(item.transfer, item.items, item.transfer.sourceBranchId);
    }
    return { transfer: item.transfer, items: item.items };
  }

  async markInTransit(
    id: string,
    input: Parameters<InventoryTransferRepository["markInTransit"]>[1],
  ) {
    const item = this.store.transact((db) => {
      const current = this.findTransfer(db, id);
      this.assertTransferActor(db, current, input.dispatchedByUserId);
      if (!input.operationId?.trim()) throw new Error("Transfer dispatch operationId is required");
      const currentItems = db.inventoryTransferItems.filter((entry) => entry.transferId === id);
      this.assertValidQuantityUpdates(input.items, currentItems, "dispatchedQuantity");
      if (input.items.length !== currentItems.length || currentItems.some((entry) =>
        input.items.find((candidate) => candidate.itemId === entry.id)?.dispatchedQuantity !==
          entry.requestedQuantity)) {
        throw new Error("Transfer dispatch requires every requested item in full");
      }
      const picking = db.pickingOrders.find((entry) => entry.sourceType === "transfer" &&
        entry.sourceId === current.id && entry.tenantId === current.tenantId &&
        entry.branchId === current.sourceBranchId);
      const packing = db.packings.find((entry) => entry.sourceType === "transfer" &&
        entry.sourceId === current.id && entry.tenantId === current.tenantId &&
        entry.branchId === current.sourceBranchId);
      if (!picking || picking.status !== PickingStatus.completed || !packing ||
        packing.status !== PackingStatus.finalized || !packing.labelPrintedAt ||
        !packing.packageCount || !packing.totalWeight ||
        db.pickingIncidents.some((entry) => entry.pickingOrderId === picking.id &&
          entry.status === PickingIncidentStatus.open)) {
        throw new Error("Transfer Picking/Packing is not ready for Dispatch");
      }
      const fingerprint = JSON.stringify({ id, items: [...input.items].sort((a, b) =>
        a.itemId.localeCompare(b.itemId)), actor: input.dispatchedByUserId,
        packingId: packing.id, labelGenerationId: packing.labelGenerationId });
      const dispatches = db.dispatches.filter((entry) => entry.sourceType === "transfer" &&
        entry.sourceId === current.id && entry.tenantId === current.tenantId);
      if (dispatches.length > 1) throw new Error("Duplicate Transfer Dispatch records");
      const existing = dispatches[0];
      if (existing) {
        if (![InventoryTransferStatus.inTransit, InventoryTransferStatus.received].includes(current.status) ||
          existing.status !== DispatchStatus.dispatched ||
          existing.confirmationOperationId !== input.operationId ||
          existing.confirmationFingerprint !== fingerprint) {
          throw new Error("Transfer Dispatch retry conflict");
        }
        return { ...this.toTransferWithItems(db, current), changed: false };
      }
      this.assertStatus(current, [InventoryTransferStatus.preparing], "mark in transit");
      if (db.dispatches.some((entry) => entry.tenantId === current.tenantId &&
        entry.confirmationOperationId === input.operationId)) {
        throw new Error("Transfer Dispatch operationId conflict");
      }
      const now = this.now();
      const dispatchId = this.id("dispatch");
      commitPickedOrderInventoryInDatabase(db, {
        transfer: current, picking, actorUserId: input.dispatchedByUserId,
        operationId: input.operationId, referenceType: "transfer", referenceId: current.id,
        reason: `Salida por traslado ${current.number}`,
      }, { id: (prefix) => this.id(prefix), now: () => now });
      db.dispatches.push({
        id: dispatchId, tenantId: current.tenantId, branchId: current.sourceBranchId,
        sourceType: "transfer", sourceId: current.id,
        status: DispatchStatus.dispatched, transportMode: TransportMode.own_fleet,
        dispatchedByUserId: input.dispatchedByUserId,
        confirmationOperationId: input.operationId, confirmationFingerprint: fingerprint,
        packageCount: packing.packageCount, weight: packing.totalWeight,
        dispatchedAt: now, createdAt: now, updatedAt: now,
      });
      for (let index = 0; index < packing.packageCount; index += 1) {
        db.packages.push({ id: this.id("package"), dispatchId, number: `${index + 1}`,
          description: packing.labelCode, createdAt: now });
      }
      input.items.forEach((nextItem) => {
        const index = db.inventoryTransferItems.findIndex((entry) => entry.id === nextItem.itemId);
        db.inventoryTransferItems[index] = {
          ...db.inventoryTransferItems[index],
          dispatchedQuantity: nextItem.dispatchedQuantity,
        };
      });
      const updated = this.replaceTransfer(db, {
        ...current,
        status: InventoryTransferStatus.inTransit,
        dispatchedByUserId: input.dispatchedByUserId,
        dispatchedAt: now,
        updatedAt: now,
      });
      return { ...this.toTransferWithItems(db, updated), changed: true };
    });
    if (item.changed) {
      this.emitChanged(item.transfer, "status_changed");
      const dispatch = this.read((db) => db.dispatches.find((entry) =>
        entry.sourceType === "transfer" && entry.sourceId === item.transfer.id));
      if (dispatch) {
        try {
          this.emit("dispatch.changed", { entityId: dispatch.id,
            tenantId: dispatch.tenantId, branchId: dispatch.branchId,
            action: "status_changed" });
        } catch { /* Commit already succeeded. */ }
      }
      this.emitTransferMovements(item.transfer, InventoryMovementType.out);
    }
    return { transfer: item.transfer, items: item.items };
  }

  async markReceived(
    id: string,
    input: Parameters<InventoryTransferRepository["markReceived"]>[1],
  ) {
    const item = this.store.transact((db) => {
      const current = this.findTransfer(db, id);
      this.assertTransferActor(db, current, input.receivedByUserId);
      if (!input.confirmationId?.trim()) throw new Error("Transfer receipt confirmationId is required");
      const currentItems = db.inventoryTransferItems.filter((entry) => entry.transferId === id);
      if (input.items.length === 0 ||
        new Set(currentItems.map((entry) => entry.productId)).size !== currentItems.length) {
        throw new Error("Transfer receipt requires unambiguous product items");
      }
      const fingerprint = JSON.stringify({ id, actor: input.receivedByUserId,
        items: input.items.map((entry) => ({
          itemId: entry.itemId, receivedQuantity: entry.receivedQuantity,
          locationId: entry.locationId, lotNumber: entry.lotNumber?.trim() || null,
          expirationDate: entry.expirationDate?.slice(0, 10) || null,
          serialNumbers: [...(entry.serialNumbers ?? [])].sort(),
        })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
      const existing = db.receipts.find((entry) => entry.tenantId === current.tenantId &&
        entry.confirmationId === input.confirmationId);
      if (existing) {
        if (existing.inventoryTransferId !== current.id ||
          existing.confirmationFingerprint !== fingerprint) {
          throw new Error("Transfer receipt retry conflict");
        }
        return { ...this.toTransferWithItems(db, current), changed: false };
      }
      this.assertStatus(current, [InventoryTransferStatus.inTransit], "mark received");
      const dispatch = db.dispatches.find((entry) => entry.sourceType === "transfer" &&
        entry.sourceId === current.id && entry.status === DispatchStatus.dispatched &&
        entry.tenantId === current.tenantId && entry.branchId === current.sourceBranchId);
      if (!dispatch) throw new Error("Transfer Dispatch not found for receipt");
      const now = this.now();
      const receiptId = this.id("receipts");
      const previousReceipts = db.receipts.filter((entry) => entry.tenantId === current.tenantId &&
        entry.inventoryTransferId === current.id);
      const receipt = {
        id: receiptId, tenantId: current.tenantId, branchId: current.destinationBranchId,
        number: `RC-${current.number}${previousReceipts.length ? `-${previousReceipts.length + 1}` : ""}`,
        inventoryTransferId: current.id,
        status: ReceiptStatus.received, confirmationId: input.confirmationId,
        confirmationFingerprint: fingerprint, receivedByUserId: input.receivedByUserId,
        receivedAt: now, createdAt: now, updatedAt: now,
      };
      const outMovements = db.inventoryMovements.filter((movement) =>
        movement.tenantId === current.tenantId && movement.branchId === current.sourceBranchId &&
        movement.referenceType === "transfer" && movement.referenceId === current.id &&
        movement.type === InventoryMovementType.out);
      const inMovements = db.inventoryMovements.filter((movement) =>
        movement.tenantId === current.tenantId && movement.branchId === current.destinationBranchId &&
        movement.referenceType === "transfer" && movement.referenceId === current.id &&
        movement.type === InventoryMovementType.in);
      const priorInMovements = [...inMovements];
      const acceptedByItem = new Map<string, number>();
      const selectedSerialIds = new Set<string>();
      const plannedByLot = new Map<string, number>();
      for (const receiptItem of input.items) {
        const transferItem = currentItems.find((entry) => entry.id === receiptItem.itemId);
        if (!transferItem || !Number.isFinite(receiptItem.receivedQuantity) ||
          receiptItem.receivedQuantity <= 0) {
          throw new Error("Transfer receipt item quantity is invalid");
        }
        const location = db.storageLocations.find((entry) => entry.id === receiptItem.locationId &&
          entry.tenantId === current.tenantId && entry.branchId === current.destinationBranchId &&
          entry.status === LocationStatus.active);
        if (!location) throw new Error("Transfer receipt destination location is unavailable");
        const movements = outMovements.filter((entry) => entry.productId === transferItem.productId);
        if (movements.reduce((sum, entry) => sum + entry.quantity, 0) !==
          transferItem.dispatchedQuantity) {
          throw new Error("Transfer receipt cannot reconcile physical dispatch movements");
        }
        const product = db.products.find((entry) => entry.id === transferItem.productId &&
          entry.tenantId === current.tenantId);
        if (!product) throw new Error("Transfer receipt product is unavailable");
        if (!product.tracking.lot && (receiptItem.lotNumber?.trim() ||
          receiptItem.expirationDate?.trim())) {
          throw new Error("Transfer receipt cannot add a lot to an untracked product");
        }
        const sourceLotFor = (movement: typeof movements[number]) => db.stockLots.find((entry) =>
          entry.id === movement.lotId && entry.tenantId === current.tenantId &&
          entry.branchId === current.sourceBranchId && entry.productId === transferItem.productId);
        const matching = product.tracking.lot
          ? movements.filter((movement) => {
            const lot = sourceLotFor(movement);
            return lot?.lotNumber === receiptItem.lotNumber?.trim() &&
              (lot?.expirationDate?.slice(0, 10) ?? "") === (receiptItem.expirationDate?.slice(0, 10) ?? "");
          })
          : movements;
        if (!matching.length || (product.tracking.lot &&
          movements.some((movement) => !sourceLotFor(movement)))) {
          throw new Error("Transfer receipt lot was not dispatched");
        }
        const sourceLot = product.tracking.lot ? sourceLotFor(matching[0]) : undefined;
        if (product.tracking.lot && !sourceLot) {
          throw new Error("Transfer source lot evidence is missing");
        }
        const lotKey = JSON.stringify([transferItem.id, sourceLot?.lotNumber ?? "",
          sourceLot?.expirationDate?.slice(0, 10) ?? ""]);
        const previouslyReceived = priorInMovements.filter((movement) => {
          if (movement.productId !== transferItem.productId) return false;
          if (!product.tracking.lot) return true;
          const lot = db.stockLots.find((entry) => entry.id === movement.lotId &&
            entry.tenantId === current.tenantId && entry.branchId === current.destinationBranchId);
          return lot?.lotNumber === sourceLot?.lotNumber &&
            lot?.expirationDate === sourceLot?.expirationDate;
        });
        const sentQuantity = matching.reduce((sum, movement) => sum + movement.quantity, 0);
        const receivedQuantity = previouslyReceived.reduce((sum, movement) => sum + movement.quantity, 0);
        const planned = plannedByLot.get(lotKey) ?? 0;
        if (receivedQuantity + planned + receiptItem.receivedQuantity > sentQuantity ||
          transferItem.receivedQuantity + (acceptedByItem.get(transferItem.id) ?? 0) +
            receiptItem.receivedQuantity > transferItem.dispatchedQuantity) {
          throw new Error("Transfer receipt exceeds pending dispatched quantity");
        }
        plannedByLot.set(lotKey, planned + receiptItem.receivedQuantity);
        const serialNames = receiptItem.serialNumbers ?? [];
        const selectedMovements = product.tracking.serial
          ? serialNames.map((name) => {
            const serial = db.serialNumbers.find((entry) => entry.tenantId === current.tenantId &&
              entry.productId === transferItem.productId && entry.serialNumber === name &&
              entry.branchId === current.sourceBranchId && entry.status === SerialStatus.in_transit);
            const movement = matching.find((entry) => entry.serialNumberId === serial?.id &&
              entry.quantity === 1);
            if (!serial || !movement || serial.lotId !== movement.lotId ||
              selectedSerialIds.has(serial.id) ||
              inMovements.some((entry) => entry.serialNumberId === serial.id)) {
              throw new Error("Transfer receipt serial was not dispatched or was already received");
            }
            selectedSerialIds.add(serial.id);
            return movement;
          })
          : [{ quantity: receiptItem.receivedQuantity, serialNumberId: undefined }];
        if (product.tracking.serial && (serialNames.length !== receiptItem.receivedQuantity ||
          new Set(serialNames).size !== serialNames.length)) {
          throw new Error("Transfer receipt serial count does not match accepted quantity");
        }
        if (!product.tracking.serial && serialNames.length) {
          throw new Error("Transfer receipt cannot add serials to a non-serialized product");
        }
        let balance = db.inventoryBalances.find((entry) =>
          entry.tenantId === current.tenantId && entry.branchId === current.destinationBranchId &&
          entry.productId === transferItem.productId && entry.locationId === location.id);
        if (!balance) {
          balance = { id: this.id("inventory-balance"), tenantId: current.tenantId,
            branchId: current.destinationBranchId, productId: transferItem.productId,
            locationId: location.id, quantity: 0, reservedQuantity: 0, updatedAt: now };
          db.inventoryBalances.push(balance);
        }
        let destinationLotId: string | undefined;
        if (sourceLot) {
          let destinationLot = db.stockLots.find((entry) =>
            entry.tenantId === current.tenantId && entry.branchId === current.destinationBranchId &&
            entry.productId === transferItem.productId && entry.locationId === location.id &&
            entry.lotNumber === sourceLot.lotNumber);
          if (destinationLot && destinationLot.expirationDate !== sourceLot.expirationDate) {
            throw new Error("Transfer destination lot metadata conflicts with source");
          }
          if (!destinationLot) {
            destinationLot = { id: this.id("stock-lot"), tenantId: current.tenantId,
              branchId: current.destinationBranchId, productId: transferItem.productId,
              locationId: location.id, lotNumber: sourceLot.lotNumber,
              expirationDate: sourceLot.expirationDate, quantity: 0, createdAt: now };
            db.stockLots.push(destinationLot);
          }
          destinationLot.quantity += receiptItem.receivedQuantity;
          destinationLotId = destinationLot.id;
        }
        for (const movement of selectedMovements) {
          const serial = movement.serialNumberId
            ? db.serialNumbers.find((entry) => entry.id === movement.serialNumberId)
            : undefined;
          if (serial) {
            serial.branchId = current.destinationBranchId;
            serial.locationId = location.id;
            serial.lotId = destinationLotId;
            serial.status = SerialStatus.available;
            serial.updatedAt = now;
          }
          const before = balance.quantity;
          balance.quantity += movement.quantity;
          balance.updatedAt = now;
          const added = { id: this.id("movement"), tenantId: current.tenantId,
            branchId: current.destinationBranchId, productId: transferItem.productId,
            lotId: destinationLotId, serialNumberId: movement.serialNumberId,
            type: InventoryMovementType.in, reason: `Entrada por traslado ${current.number}`,
            quantity: movement.quantity, quantityBefore: before, quantityAfter: balance.quantity,
            toLocationId: location.id, referenceType: "transfer", referenceId: current.id,
            performedByUserId: input.receivedByUserId, createdAt: now };
          db.inventoryMovements.push(added);
          inMovements.push(added);
        }
        db.receiptLines.push({ id: this.id("receipt-line"), receiptId,
          productId: transferItem.productId, orderedQuantity: receiptItem.receivedQuantity,
          receivedQuantity: receiptItem.receivedQuantity,
          inventoryQuantity: receiptItem.receivedQuantity,
          status: ReceiptLineStatus.complete, locationId: location.id,
          lotId: destinationLotId, lotNumber: sourceLot?.lotNumber,
          expirationDate: sourceLot?.expirationDate,
          serialNumbers: product.tracking.serial ? serialNames : undefined });
        acceptedByItem.set(transferItem.id,
          (acceptedByItem.get(transferItem.id) ?? 0) + receiptItem.receivedQuantity);
      }
      db.receipts.push(receipt);
      acceptedByItem.forEach((receivedNow, itemId) => {
        const index = db.inventoryTransferItems.findIndex((entry) => entry.id === itemId);
        db.inventoryTransferItems[index] = {
          ...db.inventoryTransferItems[index],
          receivedQuantity: db.inventoryTransferItems[index].receivedQuantity + receivedNow,
        };
      });
      const complete = currentItems.every((entry) =>
        db.inventoryTransferItems.find((item) => item.id === entry.id)?.receivedQuantity ===
          entry.dispatchedQuantity);
      const updated = this.replaceTransfer(db, {
        ...current,
        status: complete ? InventoryTransferStatus.received : InventoryTransferStatus.inTransit,
        receivedByUserId: complete ? input.receivedByUserId : current.receivedByUserId,
        receivedAt: complete ? now : current.receivedAt,
        updatedAt: now,
      });
      return { ...this.toTransferWithItems(db, updated), changed: true };
    });
    if (item.changed) {
      this.emitChanged(item.transfer, "status_changed");
      const receipt = this.read((db) => db.receipts.find((entry) =>
        entry.inventoryTransferId === item.transfer.id &&
        entry.confirmationId === input.confirmationId));
      if (receipt) {
        try {
          this.emit("receipt.changed", { entityId: receipt.id,
            tenantId: receipt.tenantId, branchId: receipt.branchId,
            action: "status_changed" });
        } catch { /* Commit already succeeded. */ }
      }
      this.emitTransferMovements(item.transfer, InventoryMovementType.in);
    }
    return { transfer: item.transfer, items: item.items };
  }

  async cancel(id: string, input: Parameters<InventoryTransferRepository["cancel"]>[1]) {
    const item = this.store.transact((db) => {
      const current = this.findTransfer(db, id);
      this.assertTransferActor(db, current, input.actorUserId);
      if (!input.operationId?.trim()) throw new Error("Transfer cancel operationId is required");
      const fingerprint = JSON.stringify({ id, reason: input.reason.trim(),
        actorUserId: input.actorUserId });
      if (current.status === InventoryTransferStatus.cancelled) {
        if (current.cancelOperationId !== input.operationId ||
          current.cancelFingerprint !== fingerprint) throw new Error("Transfer cancel retry conflict");
        return { ...this.toTransferWithItems(db, current), changed: false };
      }
      this.assertStatus(current, [InventoryTransferStatus.preparing], "cancel");
      if (db.dispatches.some((entry) => entry.sourceType === "transfer" &&
        entry.sourceId === current.id)) throw new Error("Dispatched Transfer cannot be cancelled");
      const now = this.now();
      for (const reservation of db.inventoryReservations.filter((entry) =>
        entry.sourceType === "transfer" && entry.sourceId === current.id &&
        entry.tenantId === current.tenantId)) {
        if (reservation.status !== InventoryReservationStatus.active) {
          throw new Error("Transfer reservation is not active");
        }
        for (const allocation of reservation.allocations) {
          if (allocation.consumedQuantity !== 0) throw new Error("Transfer has consumed stock");
          const balance = db.inventoryBalances.find((entry) => entry.id === allocation.balanceId &&
            entry.tenantId === current.tenantId && entry.branchId === current.sourceBranchId);
          if (!balance || balance.reservedQuantity < allocation.reservedQuantity) {
            throw new Error("Transfer reservation balance conflict");
          }
          balance.reservedQuantity -= allocation.reservedQuantity;
          balance.updatedAt = now;
        }
        reservation.status = InventoryReservationStatus.released;
        reservation.updatedAt = now;
      }
      const picking = db.pickingOrders.find((entry) => entry.sourceType === "transfer" &&
        entry.sourceId === current.id);
      if (picking) {
        picking.status = PickingStatus.cancelled;
        picking.updatedAt = now;
        for (const line of db.pickingItems.filter((entry) =>
          entry.pickingOrderId === picking.id)) {
          line.pickedQuantity = 0;
          line.pickedAllocations = undefined;
          line.serialNumbers = undefined;
          line.lotId = undefined;
          line.status = PickingItemStatus.pending;
        }
      }
      const updated = this.replaceTransfer(db, {
        ...current,
        status: InventoryTransferStatus.cancelled,
        notes: input.reason.trim() || current.notes,
        cancelledAt: now,
        cancelledByUserId: input.actorUserId,
        cancelOperationId: input.operationId,
        cancelFingerprint: fingerprint,
        updatedAt: now,
      });
      return { ...this.toTransferWithItems(db, updated), changed: true };
    });
    if (item.changed) {
      this.emitChanged(item.transfer, "status_changed");
      const picking = this.read((db) => db.pickingOrders.find((entry) =>
        entry.sourceType === "transfer" && entry.sourceId === item.transfer.id));
      if (picking) this.emitPickingChanged(picking, "status_changed");
      this.emitStockChanged(item.transfer, item.items, item.transfer.sourceBranchId);
    }
    return { transfer: item.transfer, items: item.items };
  }

  private assertValidCreateInput(db: MockDatabase, input: CreateInventoryTransferInput): void {
    if (!input.operationId?.trim()) throw new Error("Transfer operationId is required");
    const actor = db.users.find((user) => user.id === input.preparedByUserId &&
      user.tenantId === input.tenantId && user.status === UserStatus.active &&
      user.type === UserType.employee);
    if (!actor) throw new Error("Transfer actor is not active in tenant");
    if (input.sourceBranchId === input.destinationBranchId) {
      throw new Error("Inventory transfer branches must be different");
    }
    const sourceBranch = db.branches.find((branch) => branch.id === input.sourceBranchId);
    if (!sourceBranch) throw this.missing("Branch", input.sourceBranchId);
    const destinationBranch = db.branches.find((branch) => branch.id === input.destinationBranchId);
    if (!destinationBranch) throw this.missing("Branch", input.destinationBranchId);
    if (sourceBranch.tenantId !== input.tenantId || destinationBranch.tenantId !== input.tenantId) {
      throw new Error("Inventory transfer branches must match transfer tenant");
    }
    if (sourceBranch.status !== BranchStatus.active || destinationBranch.status !== BranchStatus.active) {
      throw new Error("Inventory transfer branches must be active");
    }
    if (input.items.length === 0) {
      throw new Error("Inventory transfer must include at least one item");
    }
    if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) {
      throw new Error("Inventory transfer cannot repeat a product in multiple items");
    }
    this.assertValidTransferSourceRequests(input);
    input.items.forEach((item) => {
      const product = db.products.find((entry) => entry.id === item.productId);
      if (!product) throw this.missing("Product", item.productId);
      if (product.tenantId !== input.tenantId) {
        throw new Error("Inventory transfer item product must match transfer tenant");
      }
      if (product.productType !== ProductType.physical || !product.tracking.stock) {
        throw new Error("Inventory transfer requires a stock-tracked physical product");
      }
      if (item.sourceRequestId) {
        this.assertValidSourceRequest(db, {
          requestId: item.sourceRequestId,
          tenantId: input.tenantId,
          sourceBranchId: input.sourceBranchId,
          destinationBranchId: input.destinationBranchId,
          productId: item.productId,
        });
      }
      this.assertValidCreateQuantities(item);
    });
  }

  private assertTransferActor(db: MockDatabase, transfer: InventoryTransfer, actorUserId: string) {
    if (!db.users.some((user) => user.id === actorUserId && user.tenantId === transfer.tenantId &&
      user.status === UserStatus.active && user.type === UserType.employee)) {
      throw new Error("Transfer actor is not active in tenant");
    }
  }

  private assertValidTransferSourceRequests(input: CreateInventoryTransferInput): void {
    const transferRequestIds = new Set(input.sourceRequestIds ?? []);
    const itemRequestIds = new Set(
      input.items.flatMap((item) => (item.sourceRequestId ? [item.sourceRequestId] : [])),
    );
    if (transferRequestIds.size === 0) return;

    itemRequestIds.forEach((requestId) => {
      if (!transferRequestIds.has(requestId)) {
        throw new Error(
          "Inventory transfer item sourceRequestId must be listed in sourceRequestIds",
        );
      }
    });
    transferRequestIds.forEach((requestId) => {
      if (!itemRequestIds.has(requestId)) {
        throw new Error(
          "Inventory transfer sourceRequestIds must match item sourceRequestId values",
        );
      }
    });
  }

  private assertValidSourceRequest(
    db: MockDatabase,
    input: {
      requestId: string;
      tenantId: string;
      sourceBranchId: string;
      destinationBranchId: string;
      productId: string;
    },
  ): void {
    const { requestId, tenantId, sourceBranchId, destinationBranchId, productId } = input;
    const request = db.inventoryTransferRequests.find((item) => item.id === requestId);
    if (!request) throw this.missing("InventoryTransferRequest", requestId);
    if (request.tenantId !== tenantId) {
      throw new Error("Inventory transfer source request must match transfer tenant");
    }
    if (request.status !== InventoryTransferRequestStatus.approved) {
      throw new Error("Inventory transfer source request must be approved");
    }
    if (request.sourceBranchId !== sourceBranchId) {
      throw new Error("Inventory transfer source request must match transfer source branch");
    }
    if (request.requestingBranchId !== destinationBranchId) {
      throw new Error("Inventory transfer source request must match transfer destination branch");
    }
    if (request.productId !== productId) {
      throw new Error("Inventory transfer source request product must match transfer item product");
    }
  }

  private assertValidCreateQuantities(item: CreateInventoryTransferInput["items"][number]): void {
    const dispatchedQuantity = item.dispatchedQuantity ?? 0;
    const receivedQuantity = item.receivedQuantity ?? 0;
    this.assertRequestedQuantity(item.requestedQuantity);
    this.assertQuantity(dispatchedQuantity, "dispatchedQuantity");
    this.assertQuantity(receivedQuantity, "receivedQuantity");
    if (dispatchedQuantity !== 0 || receivedQuantity !== 0) {
      throw new Error("A new Transfer cannot begin with dispatched or received stock");
    }
    if (dispatchedQuantity > item.requestedQuantity) {
      throw new Error(
        "Inventory transfer dispatchedQuantity must be less than or equal to requestedQuantity",
      );
    }
    if (receivedQuantity > dispatchedQuantity) {
      throw new Error(
        "Inventory transfer receivedQuantity must be less than or equal to dispatchedQuantity",
      );
    }
  }

  private assertValidQuantityUpdates(
    updates: Array<{
      itemId: string;
      dispatchedQuantity?: number;
      receivedQuantity?: number;
    }>,
    currentItems: InventoryTransferItem[],
    field: "dispatchedQuantity" | "receivedQuantity",
  ): void {
    const itemIds = new Set(currentItems.map((item) => item.id));
    updates.forEach((item) => {
      const currentItem = currentItems.find((entry) => entry.id === item.itemId);
      if (!itemIds.has(item.itemId) || !currentItem) {
        throw this.missing("InventoryTransferItem", item.itemId);
      }
      const quantity = item[field] ?? 0;
      this.assertQuantity(quantity, field);
      if (field === "dispatchedQuantity" && quantity > currentItem.requestedQuantity) {
        throw new Error(
          "Inventory transfer dispatchedQuantity must be less than or equal to requestedQuantity",
        );
      }
      if (field === "receivedQuantity" && quantity > currentItem.dispatchedQuantity) {
        throw new Error(
          "Inventory transfer receivedQuantity must be less than or equal to dispatchedQuantity",
        );
      }
    });
  }

  private assertRequestedQuantity(value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("Inventory transfer requestedQuantity must be greater than 0");
    }
  }

  private assertQuantity(value: number, field: string): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Inventory transfer ${field} must be greater than or equal to 0`);
    }
  }

  private findTransfer(db: MockDatabase, id: string): InventoryTransfer {
    const transfer = db.inventoryTransfers.find((item) => item.id === id);
    if (!transfer) throw this.missing("InventoryTransfer", id);
    return transfer;
  }

  private findTransferWithItems(db: MockDatabase, id: string) {
    const transfer = db.inventoryTransfers.find((item) => item.id === id) ?? null;
    return transfer ? this.toTransferWithItems(db, transfer) : null;
  }

  private replaceTransfer(db: MockDatabase, transfer: InventoryTransfer): InventoryTransfer {
    const index = db.inventoryTransfers.findIndex((item) => item.id === transfer.id);
    if (index < 0) throw this.missing("InventoryTransfer", transfer.id);
    db.inventoryTransfers[index] = transfer;
    return transfer;
  }

  private toTransferWithItems(
    db: MockDatabase,
    transfer: InventoryTransfer,
  ): InventoryTransferWithItems {
    return {
      transfer,
      items: db.inventoryTransferItems.filter((item) => item.transferId === transfer.id),
    };
  }

  private assertStatus(
    transfer: InventoryTransfer,
    allowed: InventoryTransferStatus[],
    action: string,
  ): void {
    if (!allowed.includes(transfer.status)) {
      throw new Error(`Cannot ${action} inventory transfer from status ${transfer.status}`);
    }
  }

  private generateTransferNumber(db: MockDatabase, tenantId: string, date: string): string {
    const year = new Date(date).getFullYear();
    const prefix = `TR-${year}-`;
    const next =
      db.inventoryTransfers
        .filter((transfer) => transfer.tenantId === tenantId && transfer.number.startsWith(prefix))
        .map((transfer) => Number(transfer.number.slice(prefix.length)))
        .filter((value) => Number.isInteger(value))
        .reduce((max, value) => Math.max(max, value), 0) + 1;
    return `${prefix}${String(next).padStart(5, "0")}`;
  }

  private getTransferSourceRequestIds(input: CreateInventoryTransferInput): string[] {
    return [
      ...new Set([
        ...(input.sourceRequestIds ?? []),
        ...input.items.flatMap((item) => (item.sourceRequestId ? [item.sourceRequestId] : [])),
      ]),
    ];
  }

  private emitChanged(transfer: InventoryTransfer, action: "created" | "status_changed"): void {
    try { this.emit("inventory-transfer.changed", {
      entityId: transfer.id,
      tenantId: transfer.tenantId,
      branchId: transfer.sourceBranchId,
      action,
      metadata: {
        number: transfer.number,
        sourceBranchId: transfer.sourceBranchId,
        destinationBranchId: transfer.destinationBranchId,
        status: transfer.status,
      },
    }); } catch { /* Authoritative commit already succeeded. */ }
  }

  private emitPickingChanged(
    picking: { id: string; tenantId: string; branchId: string; orderId?: string; sourceType?: "order" | "transfer"; sourceId?: string },
    action: "created" | "status_changed",
  ) {
    try { this.emit("picking.changed", { entityId: picking.id,
      tenantId: picking.tenantId, branchId: picking.branchId,
      pickingOrderId: picking.id, orderId: picking.orderId, sourceType: picking.sourceType,
      sourceId: picking.sourceId, action });
    } catch { /* Authoritative commit already succeeded. */ }
  }

  private emitStockChanged(
    transfer: InventoryTransfer, items: InventoryTransferItem[], branchId: string,
  ) {
    for (const item of items) {
      try { this.emit("stock.changed", { entityId: transfer.id,
        tenantId: transfer.tenantId, branchId, productId: item.productId,
        action: "updated" });
      } catch { /* Authoritative commit already succeeded. */ }
    }
  }

  private emitTransferMovements(transfer: InventoryTransfer, type: InventoryMovementType) {
    const movements = this.read((db) => db.inventoryMovements.filter((entry) =>
      entry.tenantId === transfer.tenantId && entry.referenceType === "transfer" &&
      entry.referenceId === transfer.id && entry.type === type));
    for (const movement of movements) {
      const payload = { entityId: movement.id, tenantId: movement.tenantId,
        branchId: movement.branchId, productId: movement.productId,
        action: "created" as const };
      try { this.emit("inventory.changed", payload); } catch { /* Committed. */ }
      try { this.emit("stock.changed", payload); } catch { /* Committed. */ }
    }
  }
}
