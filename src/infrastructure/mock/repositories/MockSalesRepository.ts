import { SaleStatus } from "@/core/enums";
import type { Sale, SaleItem } from "@/core/entities";
import type { SalesRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockSalesRepository extends BaseMockRepository implements SalesRepository {
  async getAll() {
    return this.read((db) => db.sales);
  }
  async listByTenant(tenantId: string) {
    return this.read((db) => db.sales.filter((item) => item.tenantId === tenantId));
  }
  async listByBranch(tenantId: string, branchId: string) {
    return this.read((db) =>
      db.sales.filter((item) => item.tenantId === tenantId && item.branchId === branchId),
    );
  }
  async getById(id: string) {
    return this.read((db) => db.sales.find((item) => item.id === id) ?? null);
  }
  async getByIdScoped(tenantId: string, branchId: string, id: string) {
    return this.read(
      (db) =>
        db.sales.find(
          (item) => item.id === id && item.tenantId === tenantId && item.branchId === branchId,
        ) ?? null,
    );
  }
  async getByDocumentNumber(tenantId: string, branchId: string, documentNumber: string) {
    const normalized = documentNumber.trim().toLocaleUpperCase();
    if (!normalized) return null;
    return this.read(
      (db) =>
        db.sales.find(
          (item) =>
            item.tenantId === tenantId &&
            item.branchId === branchId &&
            item.number.toLocaleUpperCase() === normalized,
        ) ?? null,
    );
  }
  async create(input: Parameters<SalesRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const saleId = this.id("sale");
      const items: SaleItem[] = input.items.map((saleItem) => ({
        ...saleItem,
        id: this.id("sale-item"),
        saleId,
      }));
      const created: Sale = {
        ...input,
        id: saleId,
        number: this.nextSaleNumber(db.sales, input.tenantId),
        items,
        status: SaleStatus.completed,
        createdAt: now,
        updatedAt: now,
      };
      db.sales.push(created);
      db.saleItems.push(...items);
      return created;
    });
    this.emit("sale.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }

  private nextSaleNumber(sales: Sale[], tenantId: string): string {
    const prefix = "POS-";
    const next =
      sales
        .filter((sale) => sale.tenantId === tenantId && sale.number.startsWith(prefix))
        .map((sale) => Number(sale.number.slice(prefix.length)))
        .filter((value) => Number.isInteger(value))
        .reduce((max, value) => Math.max(max, value), 0) + 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
  }
  async updateStatus(id: string, status: SaleStatus) {
    const item = this.store.mutate((db) =>
      this.updateById(db.sales, id, { status: status }, "Sale"),
    );
    this.emit("sale.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "status_changed",
    });
    return item;
  }
}
