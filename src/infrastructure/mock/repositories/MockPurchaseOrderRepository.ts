import { PurchaseOrderStatus } from "@/core/enums";
import type { PurchaseOrder } from "@/core/entities";
import type { PurchaseOrderRepository } from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockPurchaseOrderRepository
  extends BaseMockRepository
  implements PurchaseOrderRepository
{
  async getAll() {
    return this.read((db) => db.purchaseOrders.map((order) => hydratePurchaseOrder(order, db)));
  }
  async getById(id: string) {
    return this.read((db) => {
      const order = db.purchaseOrders.find((item) => item.id === id);
      return order ? hydratePurchaseOrder(order, db) : null;
    });
  }
  async listByTenant(tenantId: string) {
    return this.read((db) =>
      db.purchaseOrders
        .filter((order) => order.tenantId === tenantId)
        .map((order) => hydratePurchaseOrder(order, db)),
    );
  }
  async getPageScoped(
    tenantId: string,
    params: Parameters<PurchaseOrderRepository["getPageScoped"]>[1],
  ) {
    const orders = await this.listByTenant(tenantId);
    const filtered = orders
      .filter((order) => !params.branchId || order.branchId === params.branchId)
      .filter((order) => !params.supplierId || order.supplierId === params.supplierId)
      .filter((order) => !params.status || order.status === params.status)
      .sort((left, right) => {
        const byDate = right.createdAt.localeCompare(left.createdAt);
        return byDate || right.id.localeCompare(left.id);
      });
    const start = (params.page - 1) * params.pageSize;
    return {
      items: filtered.slice(start, start + params.pageSize),
      page: params.page,
      pageSize: params.pageSize,
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / params.pageSize),
    };
  }
  async getByIdScoped(tenantId: string, id: string) {
    return this.read((db) => {
      const order = db.purchaseOrders.find(
        (item) => item.id === id && item.tenantId === tenantId,
      );
      return order ? hydratePurchaseOrder(order, db) : null;
    });
  }
  async create(input: Parameters<PurchaseOrderRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const { items = [], number, ...orderInput } = input;
      assertValidConversionSnapshots(items);
      const created = {
        ...orderInput,
        id: this.id("purchaseOrders"),
        number: number ?? nextPurchaseOrderNumber(db),
        createdAt: now,
        updatedAt: now,
      };
      db.purchaseOrders.push(created);
      const createdItems = items.map((orderItem) => ({
        ...orderItem,
        id: this.id("purchase-order-item"),
        purchaseOrderId: created.id,
      }));
      db.purchaseOrderItems.push(...createdItems);
      return { ...created, items: createdItems };
    });
    this.emit("purchase-order.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }
  async update(id: string, input: Parameters<PurchaseOrderRepository["update"]>[1]) {
    const item = this.store.mutate((db) => {
      const { items, ...orderInput } = input;
      if (items) assertValidConversionSnapshots(items);
      const updated = this.updateById(db.purchaseOrders, id, orderInput, "PurchaseOrder");
      if (items) {
        db.purchaseOrderItems = db.purchaseOrderItems.filter(
          (orderItem) => orderItem.purchaseOrderId !== id,
        );
        db.purchaseOrderItems.push(
          ...items.map((orderItem) => ({
            ...orderItem,
            id: this.id("purchase-order-item"),
            purchaseOrderId: id,
          })),
        );
      }
      return hydratePurchaseOrder(updated, db);
    });
    this.emit("purchase-order.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "updated",
    });
    return item;
  }
  async updateScoped(
    tenantId: string,
    id: string,
    input: Parameters<PurchaseOrderRepository["updateScoped"]>[2],
  ) {
    const item = this.store.mutate((db) => {
      const index = db.purchaseOrders.findIndex(
        (order) => order.id === id && order.tenantId === tenantId,
      );
      if (index < 0) throw this.missing("PurchaseOrder", id);
      const { items, ...orderInput } = input;
      if (items) assertValidConversionSnapshots(items);
      const updated = {
        ...db.purchaseOrders[index],
        ...orderInput,
        updatedAt: this.now(),
      };
      db.purchaseOrders[index] = updated;
      if (items) {
        db.purchaseOrderItems = db.purchaseOrderItems.filter(
          (orderItem) => orderItem.purchaseOrderId !== id,
        );
        db.purchaseOrderItems.push(
          ...items.map((orderItem) => ({
            ...orderItem,
            id: this.id("purchase-order-item"),
            purchaseOrderId: id,
          })),
        );
      }
      return hydratePurchaseOrder(updated, db);
    });
    this.emit("purchase-order.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "updated",
    });
    return item;
  }
  async updateStatus(id: string, status: PurchaseOrderStatus) {
    const item = this.store.mutate((db) =>
      hydratePurchaseOrder(
        this.updateById(db.purchaseOrders, id, { status: status }, "PurchaseOrder"),
        db,
      ),
    );
    this.emit("purchase-order.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "status_changed",
    });
    return item;
  }
  async updateStatusScoped(tenantId: string, id: string, status: PurchaseOrderStatus) {
    const item = this.store.mutate((db) => {
      const index = db.purchaseOrders.findIndex(
        (order) => order.id === id && order.tenantId === tenantId,
      );
      if (index < 0) throw this.missing("PurchaseOrder", id);
      const updated = { ...db.purchaseOrders[index], status, updatedAt: this.now() };
      db.purchaseOrders[index] = updated;
      return hydratePurchaseOrder(updated, db);
    });
    this.emit("purchase-order.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "status_changed",
    });
    return item;
  }
  async submitScoped(tenantId: string, id: string) {
    return this.updateStatusScoped(tenantId, id, PurchaseOrderStatus.pending_approval);
  }
  async approveScoped(tenantId: string, id: string) {
    return this.updateStatusScoped(tenantId, id, PurchaseOrderStatus.approved);
  }
  async cancelScoped(tenantId: string, id: string, reason: string) {
    const item = this.store.mutate((db) => {
      const index = db.purchaseOrders.findIndex(
        (order) => order.id === id && order.tenantId === tenantId,
      );
      if (index < 0) throw this.missing("PurchaseOrder", id);
      const now = this.now();
      const updated = {
        ...db.purchaseOrders[index],
        status: PurchaseOrderStatus.cancelled,
        cancellationReason: reason.trim(),
        cancelledAt: now,
        updatedAt: now,
      };
      db.purchaseOrders[index] = updated;
      return hydratePurchaseOrder(updated, db);
    });
    this.emit("purchase-order.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "status_changed",
    });
    return item;
  }
}

function assertValidConversionSnapshots(
  items: Parameters<PurchaseOrderRepository["create"]>[0]["items"],
) {
  if (
    items?.some(
      (item) => !Number.isFinite(item.purchaseToBaseFactor) || item.purchaseToBaseFactor <= 0,
    )
  ) {
    throw new Error("Purchase order conversion factor must be greater than zero");
  }
}

function hydratePurchaseOrder(order: PurchaseOrder, db: MockDatabase): PurchaseOrder {
  return {
    ...order,
    items: db.purchaseOrderItems.filter((item) => item.purchaseOrderId === order.id),
  };
}

function nextPurchaseOrderNumber(db: MockDatabase) {
  const next =
    db.purchaseOrders.reduce((max, order) => {
      const match = /^OC-(\d+)$/.exec(order.number);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  return `OC-${String(next).padStart(3, "0")}`;
}
