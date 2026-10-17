import { UnitStatus } from "@/core/enums";
import type { UnitRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockUnitRepository extends BaseMockRepository implements UnitRepository {
  async getAll() {
    return this.read((db) => db.units);
  }
  async getByTenant(tenantId: string) {
    return this.read((db) => db.units.filter((item) => item.tenantId === tenantId));
  }
  async getById(id: string) {
    return this.read((db) => db.units.find((item) => item.id === id) ?? null);
  }
  async getByIdScoped(tenantId: string, id: string) {
    return this.read(
      (db) => db.units.find((item) => item.id === id && item.tenantId === tenantId) ?? null,
    );
  }
  async getActive() {
    return this.read((db) => db.units.filter((item) => item.status === "active"));
  }
  async getActiveByTenant(tenantId: string) {
    return this.read((db) =>
      db.units.filter((item) => item.tenantId === tenantId && item.status === UnitStatus.active),
    );
  }
  async getAllConversionsByTenant(tenantId: string) {
    return this.read((db) =>
      db.unitConversions
        .filter((item) => item.tenantId === tenantId)
        .sort((a, b) => a.fromUnitId.localeCompare(b.fromUnitId)),
    );
  }
  async getConversionsByProduct(productId: string) {
    return this.read((db) =>
      db.unitConversions
        .filter((item) => item.productId === productId)
        .sort((a, b) => a.fromUnitId.localeCompare(b.fromUnitId)),
    );
  }
  async getConversionsByProductScoped(tenantId: string, productId: string) {
    return this.read((db) => {
      const product = db.products.find(
        (item) => item.id === productId && item.tenantId === tenantId,
      );
      if (!product) return [];
      return db.unitConversions
        .filter((item) => item.tenantId === tenantId && item.productId === productId)
        .sort((a, b) => a.fromUnitId.localeCompare(b.fromUnitId));
    });
  }
  async getConversion(input: Parameters<UnitRepository["getConversion"]>[0]) {
    return this.read(
      (db) =>
        db.unitConversions.find(
          (item) =>
            item.tenantId === input.tenantId &&
            item.productId === input.productId &&
            item.fromUnitId === input.fromUnitId &&
            item.toUnitId === input.toUnitId,
        ) ?? null,
    );
  }
  async create(input: Parameters<UnitRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("units"), createdAt: now, updatedAt: now };
      db.units.push(created);
      return created;
    });
    this.emit("business-config.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }
  async update(id: string, input: Parameters<UnitRepository["update"]>[1]) {
    const item = this.store.mutate((db) => this.updateById(db.units, id, input, "Unit"));
    this.emit("business-config.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "updated",
    });
    return item;
  }
  async upsertConversion(input: Parameters<UnitRepository["upsertConversion"]>[0]) {
    this.assertValidConversion(input.factor);
    const item = this.store.mutate((db) => {
      if (input.productId) {
        const product = db.products.find((item) => item.id === input.productId);
        if (!product) throw this.missing("Product", input.productId);
        if (product.tenantId !== input.tenantId) {
          throw new Error("Unit conversion tenant must match product tenant");
        }
      }
      this.assertConversionUnits(db.units, input.tenantId, input.fromUnitId, input.toUnitId);
      const existingIndex = db.unitConversions.findIndex(
        (conversion) =>
          conversion.tenantId === input.tenantId &&
          conversion.productId === input.productId &&
          conversion.fromUnitId === input.fromUnitId &&
          conversion.toUnitId === input.toUnitId,
      );
      if (existingIndex >= 0) {
        const updated = {
          ...db.unitConversions[existingIndex],
          ...input,
        };
        db.unitConversions[existingIndex] = updated;
        return updated;
      }
      const created = { ...input, id: this.id("unit-conversion"), createdAt: this.now() };
      db.unitConversions.push(created);
      return created;
    });
    this.emit("unit-conversion.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      productId: item.productId,
      action: "updated",
    });
    return item;
  }
  async replaceConversionsForProduct(
    productId: string,
    conversions: Parameters<UnitRepository["replaceConversionsForProduct"]>[1],
  ) {
    conversions.forEach((conversion) => this.assertValidConversion(conversion.factor));
    const items = this.store.mutate((db) => {
      const product = db.products.find((item) => item.id === productId);
      if (!product) throw this.missing("Product", productId);
      conversions.forEach((conversion) => {
        if (conversion.tenantId !== product.tenantId) {
          throw new Error("Unit conversion tenant must match product tenant");
        }
        this.assertConversionUnits(
          db.units,
          conversion.tenantId,
          conversion.fromUnitId,
          conversion.toUnitId,
        );
      });
      const keys = conversions.map((item) => `${item.fromUnitId}->${item.toUnitId}`);
      if (new Set(keys).size !== keys.length) {
        throw new Error("Duplicate unit conversion for product");
      }
      db.unitConversions = db.unitConversions.filter((item) => item.productId !== productId);
      const created = conversions.map((conversion) => ({
        ...conversion,
        productId,
        id: this.id("unit-conversion"),
        createdAt: this.now(),
      }));
      db.unitConversions.push(...created);
      return created;
    });
    this.emit("unit-conversion.changed", { productId, action: "updated" });
    return items;
  }
  async updateStatus(id: string, status: UnitStatus) {
    const item = this.store.mutate((db) =>
      this.updateById(db.units, id, { status: status }, "Unit"),
    );
    this.emit("business-config.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "status_changed",
    });
    return item;
  }
  async archive(id: string) {
    const item = this.store.mutate((db) =>
      this.updateById(db.units, id, { status: UnitStatus.archived }, "Unit"),
    );
    this.emit("business-config.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "archived",
    });
    return item;
  }
  async updateScoped(
    tenantId: string,
    id: string,
    input: Parameters<UnitRepository["updateScoped"]>[2],
  ) {
    if ("tenantId" in input && input.tenantId !== tenantId) {
      throw new Error("Cross-tenant unit update denied");
    }
    if (!(await this.getByIdScoped(tenantId, id))) throw this.missing("Unit", id);
    return this.update(id, input);
  }
  async replaceConversionsForProductScoped(
    tenantId: string,
    productId: string,
    conversions: Parameters<UnitRepository["replaceConversionsForProductScoped"]>[2],
  ) {
    if (!(await this.getByIdForProductTenant(tenantId, productId))) {
      throw this.missing("Product", productId);
    }
    return this.replaceConversionsForProduct(
      productId,
      conversions.map((conversion) => ({ ...conversion, tenantId })),
    );
  }

  private assertValidConversion(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error("Unit conversion factor must be greater than 0");
    }
  }

  private assertConversionUnits(
    units: Array<{ id: string; tenantId: string }>,
    tenantId: string,
    fromUnitId: string,
    toUnitId: string,
  ): void {
    if (fromUnitId === toUnitId) throw new Error("Unit conversion must use different units");
    if (!units.some((unit) => unit.id === fromUnitId && unit.tenantId === tenantId)) {
      throw new Error("Unit conversion source unit must belong to tenant");
    }
    if (!units.some((unit) => unit.id === toUnitId && unit.tenantId === tenantId)) {
      throw new Error("Unit conversion target unit must belong to tenant");
    }
  }

  private getByIdForProductTenant(tenantId: string, productId: string) {
    return this.read(
      (db) =>
        db.products.find((item) => item.id === productId && item.tenantId === tenantId) ?? null,
    );
  }
}
