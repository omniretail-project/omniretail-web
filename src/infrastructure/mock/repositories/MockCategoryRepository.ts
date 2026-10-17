import { CategoryStatus } from "@/core/enums";
import type { Category } from "@/core/entities";
import type { CategoryRepository } from "@/core/repositories";
import { normalizeCatalogImageSource } from "@/core/media/catalogImage";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockCategoryRepository extends BaseMockRepository implements CategoryRepository {
  async getAll() {
    return this.read((db) => db.categories);
  }
  async getByTenant(tenantId: string) {
    return this.read((db) => db.categories.filter((item) => item.tenantId === tenantId));
  }
  async getById(id: string) {
    return this.read((db) => db.categories.find((item) => item.id === id) ?? null);
  }
  async getByIdScoped(tenantId: string, id: string) {
    return this.read(
      (db) => db.categories.find((item) => item.id === id && item.tenantId === tenantId) ?? null,
    );
  }
  async getActive() {
    return this.read((db) => db.categories.filter((item) => item.status === "active"));
  }
  async getActiveByTenant(tenantId: string) {
    return this.read((db) =>
      db.categories.filter(
        (item) => item.tenantId === tenantId && item.status === CategoryStatus.active,
      ),
    );
  }
  async create(input: Parameters<CategoryRepository["create"]>[0]) {
    if (input.image && !normalizeCatalogImageSource(input.image)) {
      throw new Error("La referencia de imagen de categoria no es segura.");
    }
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("categories"), createdAt: now, updatedAt: now };
      db.categories.push(created);
      return created;
    });
    this.emit("category.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }
  async update(id: string, input: Parameters<CategoryRepository["update"]>[1]) {
    if (input.image && !normalizeCatalogImageSource(input.image)) {
      throw new Error("La referencia de imagen de categoria no es segura.");
    }
    const item = this.store.mutate((db) => this.updateById(db.categories, id, input, "Category"));
    this.emit("category.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "updated",
    });
    return item;
  }
  async updateStatus(id: string, status: CategoryStatus) {
    const item = this.store.mutate((db) =>
      this.updateById(db.categories, id, { status: status }, "Category"),
    );
    this.emit("category.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "status_changed",
    });
    return item;
  }
  async uploadImage(_id: string, _file: Blob): Promise<Category> {
    void _id;
    void _file;
    throw new Error(
      "El upload directo pertenece al adapter API; mock usa CatalogImageAssetRepository.",
    );
  }
  async removeImage(_id: string): Promise<Category> {
    void _id;
    throw new Error(
      "El borrado directo pertenece al adapter API; mock usa CatalogImageAssetRepository.",
    );
  }
  async archive(id: string) {
    const item = this.store.mutate((db) =>
      this.updateById(db.categories, id, { status: CategoryStatus.archived }, "Category"),
    );
    this.emit("category.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "archived",
    });
    return item;
  }
  async updateScoped(
    tenantId: string,
    id: string,
    input: Parameters<CategoryRepository["updateScoped"]>[2],
  ) {
    if ("tenantId" in input && input.tenantId !== tenantId) {
      throw new Error("Cross-tenant category update denied");
    }
    if (!(await this.getByIdScoped(tenantId, id))) throw this.missing("Category", id);
    return this.update(id, input);
  }
  async archiveScoped(tenantId: string, id: string) {
    if (!(await this.getByIdScoped(tenantId, id))) throw this.missing("Category", id);
    return this.archive(id);
  }
}
