import type { UserRepository } from "@/core/repositories";
import type { UserStatus } from "@/core/enums";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
export class MockUserRepository extends BaseMockRepository implements UserRepository {
  async getAll() {
    return this.read((db) => db.users);
  }
  async getById(id: string) {
    return this.read((db) => db.users.find((item) => item.id === id) ?? null);
  }
  async getByEmail(email: string) {
    return this.read(
      (db) => db.users.find((item) => item.email.toLowerCase() === email.toLowerCase()) ?? null,
    );
  }
  async listByTenant(tenantId: string) {
    return this.read((db) => db.users.filter((item) => item.tenantId === tenantId));
  }
  async getByIdScoped(tenantId: string, id: string) {
    return this.read(
      (db) => db.users.find((item) => item.id === id && item.tenantId === tenantId) ?? null,
    );
  }
  async getByEmployeeCodeScoped(tenantId: string, employeeCode: string) {
    return this.read(
      (db) =>
        db.users.find(
          (item) =>
            item.tenantId === tenantId &&
            item.employeeCode?.toUpperCase() === employeeCode.toUpperCase(),
        ) ?? null,
    );
  }
  async create(input: Parameters<UserRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("user"), createdAt: now, updatedAt: now };
      db.users.push(created);
      return created;
    });
    this.emit("user.changed", { entityId: item.id, tenantId: item.tenantId, action: "created" });
    return item;
  }
  async update(id: string, input: Parameters<UserRepository["update"]>[1]) {
    const item = this.store.mutate((db) => this.updateById(db.users, id, input, "User"));
    this.emit("user.changed", { entityId: item.id, tenantId: item.tenantId, action: "updated" });
    return item;
  }
  async updateScoped(
    tenantId: string,
    id: string,
    input: Parameters<UserRepository["updateScoped"]>[2],
  ) {
    const item = this.store.mutate((db) => {
      const index = db.users.findIndex((user) => user.id === id && user.tenantId === tenantId);
      if (index < 0) throw this.missing("User", id);
      const current = db.users[index];
      const updated = { ...current, ...input, updatedAt: this.now() };
      db.users[index] = updated;
      return updated;
    });
    this.emit("user.changed", { entityId: item.id, tenantId: item.tenantId, action: "updated" });
    return item;
  }
  async updateStatus(id: string, status: UserStatus) {
    return this.update(id, { status });
  }
}
