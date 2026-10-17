import {
  InventoryMovementType,
  LocationStatus,
  PurchaseOrderStatus,
  ReceiptLineStatus,
  ReceiptStatus,
  SerialStatus,
} from "@/core/enums";
import { isReceiptIncidentTypeCode } from "@/core/entities";
import type {
  InventoryBalance,
  InventoryMovement,
  ReceiptIncident,
  SerialNumber,
  StockLot,
} from "@/core/entities";
import type { ReceiptIncidentRecord, ReceiptRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { assertNewSerials } from "@/infrastructure/mock/repositories/serialNumberMutations";

export class MockReceiptRepository extends BaseMockRepository implements ReceiptRepository {
  async getAll() {
    return this.read((db) => db.receipts);
  }
  async getById(id: string) {
    return this.read((db) => db.receipts.find((item) => item.id === id) ?? null);
  }
  async listByTenant(tenantId: string) {
    return this.read((db) => db.receipts.filter((item) => item.tenantId === tenantId));
  }
  async getPageScoped(tenantId: string, params: Parameters<ReceiptRepository["getPageScoped"]>[1]) {
    const receipts = (await this.listByTenant(tenantId))
      .filter((receipt) => !params.branchId || receipt.branchId === params.branchId)
      .filter(
        (receipt) => !params.purchaseOrderId || receipt.purchaseOrderId === params.purchaseOrderId,
      )
      .filter((receipt) => {
        if (!params.status) return true;
        if (params.status === "draft") return receipt.status === ReceiptStatus.in_progress;
        return [ReceiptStatus.partial, ReceiptStatus.received].includes(receipt.status);
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const start = (params.page - 1) * params.pageSize;
    const pageReceipts = receipts.slice(start, start + params.pageSize);
    return {
      items: await Promise.all(
        pageReceipts.map(async (receipt) => {
          const record = await this.getRecordByIdScoped(tenantId, receipt.id);
          if (!record) throw this.missing("Receipt", receipt.id);
          return record;
        }),
      ),
      page: params.page,
      pageSize: params.pageSize,
      totalItems: receipts.length,
      totalPages: Math.ceil(receipts.length / params.pageSize),
    };
  }
  async getRecordByIdScoped(tenantId: string, id: string) {
    return this.read((db) => {
      const receipt = db.receipts.find((item) => item.id === id && item.tenantId === tenantId);
      if (!receipt) return null;
      const order = receipt.purchaseOrderId
        ? db.purchaseOrders.find((item) => item.id === receipt.purchaseOrderId)
        : undefined;
      const orderItems = db.purchaseOrderItems.filter(
        (item) => item.purchaseOrderId === receipt.purchaseOrderId,
      );
      return {
        receipt,
        purchaseOrderNumber: order?.number,
        items: db.receiptLines
          .filter((line) => line.receiptId === receipt.id)
          .map((line) => {
            const orderItem = orderItems.find((item) => item.productId === line.productId);
            const hasTracking = Boolean(
              line.lotNumber || line.expirationDate || line.serialNumbers?.length,
            );
            return {
              line,
              purchaseOrderItemId: orderItem?.id,
              productNameSnapshot: orderItem?.productNameSnapshot,
              productSkuSnapshot: orderItem?.productSkuSnapshot,
              unitId: orderItem?.unitId,
              unitSymbolSnapshot: orderItem?.unitSymbolSnapshot,
              purchaseToBaseFactor: orderItem?.purchaseToBaseFactor,
              unitCost: orderItem?.unitCost,
              trackingDetails: hasTracking
                ? [
                    {
                      baseQuantity: line.inventoryQuantity ?? line.receivedQuantity,
                      lotNumber: line.lotNumber,
                      expirationDate: line.expirationDate,
                      serialNumbers: line.serialNumbers ?? [],
                    },
                  ]
                : [],
            };
          }),
      };
    });
  }
  async getByConfirmationId(tenantId: string, confirmationId: string) {
    return this.read(
      (db) =>
        db.receipts.find(
          (item) => item.tenantId === tenantId && item.confirmationId === confirmationId,
        ) ?? null,
    );
  }
  async getLinesByReceipt(receiptId: string) {
    return this.read((db) => db.receiptLines.filter((item) => item.receiptId === receiptId));
  }
  async getIncidents() {
    return this.read((db) => db.receiptIncidents);
  }
  async create(input: Parameters<ReceiptRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("receipts"), createdAt: now, updatedAt: now };
      db.receipts.push(created);
      return created;
    });
    this.emit("receipt.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }
  async update(id: string, input: Parameters<ReceiptRepository["update"]>[1]) {
    const item = this.store.mutate((db) => this.updateById(db.receipts, id, input, "Receipt"));
    this.emit("receipt.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "updated",
    });
    return item;
  }
  async updateStatus(id: string, status: ReceiptStatus) {
    const item = this.store.mutate((db) =>
      this.updateById(db.receipts, id, { status: status }, "Receipt"),
    );
    this.emit("receipt.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "status_changed",
    });
    return item;
  }
  async confirmReceiptInventory(
    input: Parameters<ReceiptRepository["confirmReceiptInventory"]>[0],
  ) {
    const result = this.store.transact((db) => {
      if (!input.confirmationId.trim()) throw new Error("Receipt confirmationId is required");
      const existingConfirmation = db.receipts.find(
        (item) => item.tenantId === input.tenantId && item.confirmationId === input.confirmationId,
      );
      if (existingConfirmation) {
        if (existingConfirmation.confirmationFingerprint !== input.confirmationFingerprint) {
          throw new Error(`Receipt confirmation conflict: ${input.confirmationId}`);
        }
        return { receipt: existingConfirmation, movements: [] as InventoryMovement[] };
      }
      const receipt = db.receipts.find((item) => item.id === input.receiptId);
      if (!receipt) throw this.missing("Receipt", input.receiptId);
      if (receipt.status === ReceiptStatus.received || receipt.status === ReceiptStatus.partial) {
        return { receipt, movements: [] as InventoryMovement[] };
      }
      if (receipt.status !== ReceiptStatus.in_progress)
        throw new Error(`Receipt cannot be confirmed: ${receipt.id}`);
      const order = receipt.purchaseOrderId
        ? db.purchaseOrders.find((item) => item.id === receipt.purchaseOrderId)
        : undefined;
      if (!order || order.tenantId !== receipt.tenantId || order.branchId !== receipt.branchId) {
        throw new Error(`PurchaseOrder not found for Receipt: ${receipt.id}`);
      }
      const now = input.receivedAt;
      db.receiptLines = db.receiptLines.filter((line) => line.receiptId !== receipt.id);
      const lines = input.lines.map((line) => ({
        ...line,
        id: line.id ?? this.id("receipt-line"),
        receiptId: receipt.id,
      }));
      db.receiptLines.push(...lines);
      db.receiptIncidents = db.receiptIncidents.filter(
        (incident) => incident.receiptId !== receipt.id,
      );
      db.receiptIncidents.push(
        ...input.incidents.map(({ productId, ...incident }) => ({
          ...incident,
          id: incident.id ?? this.id("receipt-incident"),
          receiptId: receipt.id,
          receiptLineId: lines.find((line) => line.productId === productId)?.id,
          createdAt: incident.createdAt ?? now,
        })),
      );
      const movements: InventoryMovement[] = [];
      const serialsByLine = new Map<string, string[]>();
      lines.forEach((line) => {
        const product = db.products.find(
          (item) => item.id === line.productId && item.tenantId === receipt.tenantId,
        );
        const quantity = line.inventoryQuantity ?? line.receivedQuantity;
        if (!product?.tracking.serial || quantity <= 0) return;
        const serials = line.serialNumbers ?? [];
        if (serials.length !== quantity)
          throw new Error(`Serial count conflicts with receipt line: ${line.id}`);
        serialsByLine.set(line.id, serials);
      });
      assertNewSerials(db, receipt.tenantId, [...serialsByLine.values()].flat());
      lines.forEach((line) => {
        const inventoryQuantity = line.inventoryQuantity ?? line.receivedQuantity;
        if (inventoryQuantity <= 0) return;
        const product = db.products.find(
          (item) => item.id === line.productId && item.tenantId === receipt.tenantId,
        );
        if (!product) throw new Error(`Product not found for ReceiptLine: ${line.id}`);
        if (product.productType === "kit")
          throw new Error(`Virtual kits cannot be received: ${line.id}`);
        if (!product.tracking.stock) return;
        const capabilities = db.businessCapabilities.find(
          (item) => item.tenantId === receipt.tenantId,
        );
        // Sin configuracion del negocio el backend interpreta false: no se asume true.
        const usesLocations = capabilities?.supportsMultipleLocations ?? false;
        if (usesLocations) {
          const location = db.storageLocations.find((item) => item.id === line.locationId);
          if (
            !line.locationId ||
            !location ||
            location.tenantId !== receipt.tenantId ||
            location.branchId !== receipt.branchId ||
            location.status !== LocationStatus.active
          ) {
            throw new Error(
              `Receipt line location must be active and match the receipt tenant and branch: ${line.id}`,
            );
          }
        } else if (line.locationId) {
          throw new Error(`Receipt line location must be empty: ${line.id}`);
        }
        const balance = findOrCreateBalance(
          db.inventoryBalances,
          receipt,
          line.productId,
          line.locationId,
          now,
          (prefix) => this.id(prefix),
        );
        const before = balance.quantity;
        let lotId: string | undefined;
        if (product.tracking.lot) {
          const lotNumber = line.lotNumber?.trim();
          if (!lotNumber) throw new Error(`Lot number required for ReceiptLine: ${line.id}`);
          if (product.tracking.expiration && !line.expirationDate)
            throw new Error(`Expiration date required for ReceiptLine: ${line.id}`);
          const existing = db.stockLots.find(
            (lot) =>
              lot.tenantId === receipt.tenantId &&
              lot.branchId === receipt.branchId &&
              lot.productId === line.productId &&
              (lot.locationId ?? null) === (line.locationId ?? null) &&
              lot.lotNumber === lotNumber,
          );
          if (existing && (existing.expirationDate ?? null) !== (line.expirationDate ?? null)) {
            throw new Error(`Incompatible lot metadata for ${lotNumber}`);
          }
          const lot: StockLot = existing ?? {
            id: this.id("stock-lot"),
            tenantId: receipt.tenantId,
            branchId: receipt.branchId,
            productId: line.productId,
            locationId: line.locationId,
            lotNumber,
            expirationDate: line.expirationDate,
            quantity: 0,
            createdAt: now,
          };
          lot.quantity += inventoryQuantity;
          if (!existing) db.stockLots.push(lot);
          lotId = lot.id;
        }
        balance.quantity += inventoryQuantity;
        balance.updatedAt = now;
        const serials = serialsByLine.get(line.id) ?? [];
        const createdSerials = serials.map<SerialNumber>((serialNumber) => ({
          id: this.id("serial"),
          tenantId: receipt.tenantId,
          branchId: receipt.branchId,
          productId: line.productId,
          locationId: line.locationId,
          lotId,
          serialNumber: serialNumber.trim(),
          status: SerialStatus.available,
          createdAt: now,
          updatedAt: now,
        }));
        db.serialNumbers.push(...createdSerials);
        if (createdSerials.length > 0) {
          createdSerials.forEach((serial, index) => {
            const movement: InventoryMovement = {
              id: this.id("movement"),
              tenantId: receipt.tenantId,
              branchId: receipt.branchId,
              productId: line.productId,
              lotId,
              serialNumberId: serial.id,
              type: InventoryMovementType.in,
              reason: `Recepcion ${order.number}`,
              quantity: 1,
              quantityBefore: before + index,
              quantityAfter: before + index + 1,
              toLocationId: line.locationId,
              referenceType: "receipt",
              referenceId: receipt.id,
              performedByUserId: input.receivedByUserId,
              createdAt: now,
            };
            db.inventoryMovements.push(movement);
            movements.push(movement);
          });
          return;
        }
        const movement: InventoryMovement = {
          id: this.id("movement"),
          tenantId: receipt.tenantId,
          branchId: receipt.branchId,
          productId: line.productId,
          lotId,
          type: InventoryMovementType.in,
          reason: `Recepcion ${order.number}`,
          quantity: inventoryQuantity,
          quantityBefore: before,
          quantityAfter: balance.quantity,
          toLocationId: line.locationId,
          referenceType: "receipt",
          referenceId: receipt.id,
          performedByUserId: input.receivedByUserId,
          createdAt: now,
        };
        db.inventoryMovements.push(movement);
        movements.push(movement);
      });
      const orderItems = db.purchaseOrderItems.filter((item) => item.purchaseOrderId === order.id);
      const totalOrdered = orderItems.reduce((sum, item) => sum + item.quantity, 0);
      const priorAccepted = db.receipts
        .filter(
          (item) =>
            item.purchaseOrderId === order.id &&
            item.id !== receipt.id &&
            [ReceiptStatus.partial, ReceiptStatus.received].includes(item.status),
        )
        .flatMap((item) => db.receiptLines.filter((line) => line.receiptId === item.id))
        .reduce((sum, line) => sum + line.receivedQuantity, 0);
      const accepted = lines.reduce((sum, line) => sum + line.receivedQuantity, 0);
      const complete = totalOrdered > 0 && priorAccepted + accepted >= totalOrdered;
      receipt.status = complete ? ReceiptStatus.received : ReceiptStatus.partial;
      receipt.confirmationId = input.confirmationId;
      receipt.confirmationFingerprint = input.confirmationFingerprint;
      receipt.receivedByUserId = input.receivedByUserId;
      receipt.receivedAt = now;
      receipt.notes = input.notes;
      receipt.updatedAt = now;
      order.status = complete
        ? PurchaseOrderStatus.received
        : PurchaseOrderStatus.partially_received;
      order.updatedAt = now;
      return { receipt, movements };
    });
    this.emit("receipt.changed", {
      entityId: result.receipt.id,
      tenantId: result.receipt.tenantId,
      action: "status_changed",
    });
    result.movements.forEach((movement) =>
      this.emit("inventory.changed", {
        entityId: movement.id,
        tenantId: movement.tenantId,
        branchId: movement.branchId,
        productId: movement.productId,
        action: "created",
      }),
    );
    return result.receipt;
  }
  async replaceLines(receiptId: string, lines: Parameters<ReceiptRepository["replaceLines"]>[1]) {
    const items = this.store.mutate((db) => {
      if (!db.receipts.some((receipt) => receipt.id === receiptId)) {
        throw this.missing("Receipt", receiptId);
      }
      db.receiptLines = db.receiptLines.filter((line) => line.receiptId !== receiptId);
      const created = lines.map((line) => ({
        ...line,
        id: line.id ?? this.id("receipt-line"),
        receiptId,
      }));
      db.receiptLines.push(...created);
      this.updateById(db.receipts, receiptId, {}, "Receipt");
      return created;
    });
    this.emit("receipt.changed", { entityId: receiptId, action: "updated" });
    return items;
  }
  async addIncident(input: Parameters<ReceiptRepository["addIncident"]>[0]) {
    const item = this.store.mutate((db) => {
      const created = { ...input, id: this.id("receipt-incident"), createdAt: this.now() };
      db.receiptIncidents.push(created);
      return created;
    });
    this.emit("receipt.changed", { entityId: item.receiptId, action: "updated" });
    return item;
  }
  async replaceIncidents(
    receiptId: string,
    incidents: Parameters<ReceiptRepository["replaceIncidents"]>[1],
  ) {
    const items = this.store.mutate((db) => {
      if (!db.receipts.some((receipt) => receipt.id === receiptId)) {
        throw this.missing("Receipt", receiptId);
      }
      db.receiptIncidents = db.receiptIncidents.filter(
        (incident) => incident.receiptId !== receiptId,
      );
      const now = this.now();
      const created = incidents.map((incident) => ({
        ...incident,
        id: incident.id ?? this.id("receipt-incident"),
        receiptId,
        createdAt: incident.createdAt ?? now,
      }));
      db.receiptIncidents.push(...created);
      this.updateById(db.receipts, receiptId, {}, "Receipt");
      return created;
    });
    this.emit("receipt.changed", { entityId: receiptId, action: "updated" });
    return items;
  }
  async createDraftScoped(input: Parameters<ReceiptRepository["createDraftScoped"]>[0]) {
    const order = await this.read((db) => {
      const stored = db.purchaseOrders.find(
        (item) => item.id === input.purchaseOrderId && item.tenantId === input.tenantId,
      );
      if (!stored) return null;
      return {
        ...stored,
        items: db.purchaseOrderItems.filter(
          (item) => item.purchaseOrderId === input.purchaseOrderId,
        ),
      };
    });
    if (!order) throw this.missing("PurchaseOrder", input.purchaseOrderId);
    const receipts = await this.listByTenant(input.tenantId);
    const receipt = await this.create({
      tenantId: input.tenantId,
      branchId: order.branchId,
      number: nextMockReceiptNumber(receipts),
      purchaseOrderId: order.id,
      supplierId: order.supplierId,
      status: ReceiptStatus.in_progress,
      notes: input.notes,
    });
    await this.replaceLines(receipt.id, toMockDraftLines(input.items, order.items));
    const record = await this.getRecordByIdScoped(input.tenantId, receipt.id);
    if (!record) throw this.missing("Receipt", receipt.id);
    return record;
  }
  async updateDraftScoped(
    id: string,
    input: Parameters<ReceiptRepository["updateDraftScoped"]>[1],
  ) {
    const current = await this.getRecordByIdScoped(input.tenantId, id);
    if (!current?.receipt.purchaseOrderId) throw this.missing("Receipt", id);
    const orderItems = this.read((db) =>
      db.purchaseOrderItems.filter(
        (item) => item.purchaseOrderId === current.receipt.purchaseOrderId,
      ),
    );
    await this.replaceLines(id, toMockDraftLines(input.items, orderItems));
    await this.update(id, { notes: input.notes });
    const record = await this.getRecordByIdScoped(input.tenantId, id);
    if (!record) throw this.missing("Receipt", id);
    return record;
  }
  async deleteDraftScoped(tenantId: string, id: string) {
    this.store.mutate((db) => {
      const receipt = db.receipts.find((item) => item.id === id && item.tenantId === tenantId);
      if (!receipt) throw this.missing("Receipt", id);
      if (receipt.status !== ReceiptStatus.in_progress) {
        throw new Error(`Receipt is not a draft: ${id}`);
      }
      db.receipts = db.receipts.filter((item) => item.id !== id);
      db.receiptLines = db.receiptLines.filter((line) => line.receiptId !== id);
      db.receiptIncidents = db.receiptIncidents.filter((incident) => incident.receiptId !== id);
    });
    this.emit("receipt.changed", { entityId: id, tenantId, action: "deleted" });
  }

  async confirmDraftScoped(tenantId: string, id: string) {
    const current = await this.getRecordByIdScoped(tenantId, id);
    if (!current) throw this.missing("Receipt", id);
    const incidents = (await this.getIncidents()).filter((item) => item.receiptId === id);
    if (incidents.some((incident) => (incident.status ?? "open") === "open")) {
      throw new Error("Receipt has open incidents");
    }
    await this.confirmReceiptInventory({
      receiptId: id,
      tenantId,
      confirmationId: this.id("receipt-confirmation"),
      confirmationFingerprint: `scoped:${id}`,
      receivedByUserId: "mock-api-actor",
      receivedAt: this.now(),
      notes: current.receipt.notes,
      lines: current.items.map((item) => item.line),
      incidents: incidents.map((incident) => {
        const productId = incident.receiptLineId
          ? current.items.find((item) => item.line.id === incident.receiptLineId)?.line.productId
          : undefined;
        return {
          ...(incident.id ? { id: incident.id } : {}),
          ...(incident.createdAt ? { createdAt: incident.createdAt } : {}),
          ...(productId ? { productId } : {}),
          incidentTypeId: incident.incidentTypeId,
          description: incident.description,
          quantityAffected: incident.quantityAffected,
          evidence: incident.evidence,
          createdByUserId: incident.createdByUserId,
        };
      }),
    });
    const confirmed = await this.getRecordByIdScoped(tenantId, id);
    if (!confirmed) throw this.missing("Receipt", id);
    return confirmed;
  }

  async listIncidentsScoped(
    tenantId: string,
    receiptId: string,
    params: Parameters<ReceiptRepository["listIncidentsScoped"]>[2],
  ) {
    return this.read((db) => {
      const receipt = db.receipts.find(
        (item) => item.id === receiptId && item.tenantId === tenantId,
      );
      if (!receipt) throw this.missing("Receipt", receiptId);
      const incidents = db.receiptIncidents
        .filter((item) => item.receiptId === receiptId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const start = (params.page - 1) * params.pageSize;
      return {
        items: incidents
          .slice(start, start + params.pageSize)
          .map((incident) => toMockIncidentRecord(incident, receipt.branchId)),
        page: params.page,
        pageSize: params.pageSize,
        totalItems: incidents.length,
        totalPages: Math.ceil(incidents.length / params.pageSize),
      };
    });
  }

  async createIncidentScoped(input: Parameters<ReceiptRepository["createIncidentScoped"]>[0]) {
    const result = this.store.mutate((db) => {
      const receipt = db.receipts.find(
        (item) => item.id === input.receiptId && item.tenantId === input.tenantId,
      );
      if (!receipt) throw this.missing("Receipt", input.receiptId);
      if (Boolean(input.goodsReceiptItemId) !== (input.quantityAffected !== undefined)) {
        throw new Error("Receipt incident line and quantity must be provided together");
      }
      if (input.goodsReceiptItemId) {
        const receiptLine = db.receiptLines.find(
          (line) => line.id === input.goodsReceiptItemId && line.receiptId === receipt.id,
        );
        if (!receiptLine) throw this.missing("ReceiptLine", input.goodsReceiptItemId);
        if (
          input.quantityAffected === undefined ||
          input.quantityAffected <= 0 ||
          input.quantityAffected > receiptLine.receivedQuantity
        ) {
          throw new Error("Receipt incident quantity exceeds the received line quantity");
        }
      }
      const now = this.now();
      const incident: ReceiptIncident = {
        id: this.id("receipt-incident"),
        receiptId: receipt.id,
        ...(input.goodsReceiptItemId ? { receiptLineId: input.goodsReceiptItemId } : {}),
        incidentTypeId: input.incidentType,
        description: input.notes.trim(),
        ...(input.quantityAffected !== undefined
          ? { quantityAffected: input.quantityAffected }
          : {}),
        evidence: [],
        createdByUserId: "mock-api-actor",
        createdAt: now,
        status: "open",
        updatedAt: now,
      };
      db.receiptIncidents.push(incident);
      return toMockIncidentRecord(incident, receipt.branchId);
    });
    this.emit("receipt.changed", {
      entityId: input.receiptId,
      tenantId: input.tenantId,
      branchId: result.branchId,
      incidentId: result.id,
      action: "updated",
    });
    return result;
  }

  async resolveIncidentWithReplacementScoped(
    input: Parameters<ReceiptRepository["resolveIncidentWithReplacementScoped"]>[0],
  ) {
    await this.resolveIncidentScoped(input.tenantId, input.incidentId);
  }

  async validateSerialNumbersScoped(
    input: Parameters<ReceiptRepository["validateSerialNumbersScoped"]>[0],
  ) {
    const seen = new Set<string>();
    const repeatedInRequest = new Set<string>();
    input.serialNumbers.forEach((serial) => {
      const key = serial.trim();
      if (seen.has(key)) repeatedInRequest.add(key);
      seen.add(key);
    });
    return { duplicates: [], repeatedInRequest: [...repeatedInRequest] };
  }

  async resolveIncidentScoped(tenantId: string, incidentId: string) {
    const result = this.store.mutate((db) => {
      const incident = db.receiptIncidents.find((item) => item.id === incidentId);
      const receipt = incident
        ? db.receipts.find((item) => item.id === incident.receiptId && item.tenantId === tenantId)
        : undefined;
      if (!incident || !receipt) throw this.missing("ReceiptIncident", incidentId);
      const now = this.now();
      incident.status = "resolved";
      incident.resolvedByUserId = "mock-api-actor";
      incident.resolvedAt = now;
      incident.updatedAt = now;
      return toMockIncidentRecord(incident, receipt.branchId);
    });
    this.emit("receipt.changed", {
      entityId: result.goodsReceiptId,
      tenantId,
      branchId: result.branchId,
      incidentId,
      action: "updated",
    });
    return result;
  }
}

function toMockIncidentRecord(incident: ReceiptIncident, branchId: string): ReceiptIncidentRecord {
  return {
    id: incident.id,
    branchId,
    goodsReceiptId: incident.receiptId,
    ...(incident.receiptLineId ? { goodsReceiptItemId: incident.receiptLineId } : {}),
    incidentType: isReceiptIncidentTypeCode(incident.incidentTypeId)
      ? incident.incidentTypeId
      : "other",
    status: incident.status ?? "open",
    ...(incident.quantityAffected !== undefined
      ? { quantityAffected: incident.quantityAffected }
      : {}),
    notes: incident.description,
    createdByUserId: incident.createdByUserId,
    ...(incident.resolvedByUserId ? { resolvedByUserId: incident.resolvedByUserId } : {}),
    ...(incident.resolvedAt ? { resolvedAt: incident.resolvedAt } : {}),
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt ?? incident.createdAt,
  };
}

function nextMockReceiptNumber(receipts: Array<{ number: string }>) {
  const next =
    receipts.reduce((max, receipt) => {
      const match = /^REC-(\d+)$/.exec(receipt.number);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  return `REC-${String(next).padStart(3, "0")}`;
}

function toMockDraftLines(
  items: Parameters<ReceiptRepository["createDraftScoped"]>[0]["items"],
  orderItems: Array<{
    id: string;
    productId: string;
    quantity: number;
  }>,
) {
  return items.map((item) => {
    const orderItem = orderItems.find((candidate) => candidate.id === item.purchaseOrderItemId);
    if (!orderItem) throw new Error(`PurchaseOrderItem not found: ${item.purchaseOrderItemId}`);
    const detail = item.trackingDetails.length === 1 ? item.trackingDetails[0] : undefined;
    return {
      productId: orderItem.productId,
      orderedQuantity: orderItem.quantity,
      receivedQuantity: item.receivedQuantity,
      inventoryQuantity:
        item.trackingDetails.reduce((sum, tracking) => sum + tracking.baseQuantity, 0) ||
        item.receivedQuantity,
      status: ReceiptLineStatus.partial,
      locationId: item.locationId,
      lotNumber: detail?.lotNumber,
      expirationDate: detail?.expirationDate,
      serialNumbers: detail?.serialNumbers,
    };
  });
}

function findOrCreateBalance(
  balances: InventoryBalance[],
  receipt: { tenantId: string; branchId: string },
  productId: string,
  locationId: string | undefined,
  now: string,
  id: (prefix: string) => string,
) {
  let balance = balances.find(
    (item) =>
      item.tenantId === receipt.tenantId &&
      item.branchId === receipt.branchId &&
      item.productId === productId &&
      (item.locationId ?? null) === (locationId ?? null),
  );
  if (!balance) {
    balance = {
      id: id("balance"),
      tenantId: receipt.tenantId,
      branchId: receipt.branchId,
      productId,
      locationId,
      quantity: 0,
      reservedQuantity: 0,
      updatedAt: now,
    };
    balances.push(balance);
  }
  return balance;
}
