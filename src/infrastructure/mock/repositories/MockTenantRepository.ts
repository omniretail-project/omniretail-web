import type { TenantRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
export class MockTenantRepository extends BaseMockRepository implements TenantRepository {
  async getAll() {
    return this.read((db) => db.tenants);
  }
  async getById(id: string) {
    return this.read((db) => db.tenants.find((item) => item.id === id) ?? null);
  }
  async getBySlug(slug: string) {
    return this.read((db) => db.tenants.find((item) => item.slug === slug) ?? null);
  }
  async create(input: Parameters<TenantRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("tenant"), createdAt: now, updatedAt: now };
      db.tenants.push(created);
      return created;
    });
    return item;
  }
}
