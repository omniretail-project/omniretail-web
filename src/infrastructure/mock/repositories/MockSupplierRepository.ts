import { SupplierStatus } from "@/core/enums";
import type { SupplierRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockSupplierRepository extends BaseMockRepository implements SupplierRepository {
  async getAll() {
    return this.read((db) => db.suppliers);
  }
  async getById(id: string) {
    return this.read((db) => db.suppliers.find((item) => item.id === id) ?? null);
  }
  async getActive() {
    return this.read((db) => db.suppliers.filter((item) => item.status === "active"));
  }
  // El listado operacional paginado solo existe en modo API; el mock usa su read model local.
  async getOperationalPage(): Promise<never> {
    throw new Error("Operational supplier pages are only available in API mode.");
  }

  async getOperationalProducts(): Promise<never> {
    throw new Error("Operational supplier products are only available in API mode.");
  }

  async getOperationalIncidents(): Promise<never> {
    throw new Error("Operational supplier incidents are only available in API mode.");
  }

  async getOperationalById(): Promise<never> {
    throw new Error("Operational supplier detail is only available in API mode.");
  }

  async getActiveByTenant(tenantId: string) {
    return this.read((db) =>
      db.suppliers.filter((item) => item.status === "active" && item.tenantId === tenantId),
    );
  }
  async listByTenant(tenantId: string) {
    return this.read((db) => db.suppliers.filter((item) => item.tenantId === tenantId));
  }
  async getProductsBySupplier(supplierId: string) {
    return this.read((db) =>
      db.supplierProducts.filter((item) => item.supplierId === supplierId && item.active),
    );
  }
  async create(input: Parameters<SupplierRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("suppliers"), createdAt: now, updatedAt: now };
      db.suppliers.push(created);
      return created;
    });
    this.emit("supplier.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }
  async update(id: string, input: Parameters<SupplierRepository["update"]>[1]) {
    const item = this.store.mutate((db) => this.updateById(db.suppliers, id, input, "Supplier"));
    this.emit("supplier.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "updated",
    });
    return item;
  }
  async updateStatus(id: string, status: SupplierStatus) {
    const item = this.store.mutate((db) =>
      this.updateById(db.suppliers, id, { status: status }, "Supplier"),
    );
    this.emit("supplier.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "status_changed",
    });
    return item;
  }
  async archive(id: string) {
    const item = this.store.mutate((db) =>
      this.updateById(db.suppliers, id, { status: SupplierStatus.archived }, "Supplier"),
    );
    this.emit("supplier.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "archived",
    });
    return item;
  }
}
