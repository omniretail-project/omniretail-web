import { RoleStatus } from "@/core/enums";
import type { RoleRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockRoleRepository extends BaseMockRepository implements RoleRepository {
  async listByTenant(tenantId: string) {
    return this.read((db) => db.roles.filter((item) => item.tenantId === tenantId));
  }
  async getByIdScoped(tenantId: string, id: string) {
    return this.read(
      (db) => db.roles.find((item) => item.id === id && item.tenantId === tenantId) ?? null,
    );
  }
  async create(input: Parameters<RoleRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("role"), createdAt: now, updatedAt: now };
      db.roles.push(created);
      return created;
    });
    this.emit("role.changed", { entityId: item.id, tenantId: item.tenantId, action: "created" });
    return item;
  }
  async updateScoped(
    tenantId: string,
    id: string,
    input: Parameters<RoleRepository["updateScoped"]>[2],
  ) {
    const item = this.store.mutate((db) => {
      const index = db.roles.findIndex((role) => role.id === id && role.tenantId === tenantId);
      if (index < 0) throw this.missing("Role", id);
      const current = db.roles[index];
      const updated = {
        ...current,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(Object.hasOwn(input, "description") ? { description: input.description } : {}),
        ...(input.permissions !== undefined ? { permissions: [...input.permissions] } : {}),
        ...(input.branchScope !== undefined ? { branchScope: input.branchScope } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: this.now(),
      };
      db.roles[index] = updated;
      return updated;
    });
    this.emit("role.changed", { entityId: item.id, tenantId: item.tenantId, action: "updated" });
    return item;
  }
  async archiveScoped(tenantId: string, id: string) {
    const item = this.store.mutate((db) => {
      const index = db.roles.findIndex((role) => role.id === id && role.tenantId === tenantId);
      if (index < 0) throw this.missing("Role", id);
      const updated = {
        ...db.roles[index],
        status: RoleStatus.archived,
        updatedAt: this.now(),
      };
      db.roles[index] = updated;
      return updated;
    });
    this.emit("role.changed", { entityId: item.id, tenantId: item.tenantId, action: "archived" });
    return item;
  }
}
