import type { CustomerRepository, UpdateCustomerProfileInput } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

const PROFILE_ALLOWED_KEYS = new Set<keyof UpdateCustomerProfileInput>(["name", "phone"]);

export class MockCustomerRepository extends BaseMockRepository implements CustomerRepository {
  async getAll() {
    return this.read((db) => db.customers);
  }
  async listByTenant(tenantId: string) {
    return this.read((db) => db.customers.filter((item) => item.tenantId === tenantId));
  }
  async getById(id: string) {
    return this.read((db) => db.customers.find((item) => item.id === id) ?? null);
  }
  async getByUserId(userId: string) {
    return this.read((db) => db.customers.find((item) => item.userId === userId) ?? null);
  }
  async getByEmail(email: string) {
    return this.read(
      (db) => db.customers.find((item) => item.email.toLowerCase() === email.toLowerCase()) ?? null,
    );
  }
  async create(input: Parameters<CustomerRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("customers"), createdAt: now, updatedAt: now };
      db.customers.push(created);
      return created;
    });
    this.emit("customer.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }
  async update(id: string, input: Parameters<CustomerRepository["update"]>[1]) {
    const item = this.store.mutate((db) => this.updateById(db.customers, id, input, "Customer"));
    this.emit("customer.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "updated",
    });
    return item;
  }

  async updateProfileForCustomer(
    tenantId: string,
    customerId: string,
    input: UpdateCustomerProfileInput,
  ) {
    // Allowlist explicita en runtime -- TypeScript ya restringe el tipo
    // a name/phone, pero un caller que bypasee el tipado no debe poder
    // colar ningun otro campo (tenantId, userId, email, status, etc.)
    // a traves de este boundary de autoservicio.
    for (const key of Object.keys(input)) {
      if (!PROFILE_ALLOWED_KEYS.has(key as keyof UpdateCustomerProfileInput)) {
        throw new Error(`Customer.updateProfileForCustomer: campo no permitido "${key}"`);
      }
    }
    const item = this.store.mutate((db) => {
      const current = db.customers.find(
        (customer) => customer.id === customerId && customer.tenantId === tenantId,
      );
      if (!current) throw this.missing("Customer", customerId);
      const next = {
        ...current,
        name: input.name !== undefined ? input.name : current.name,
        phone: "phone" in input ? input.phone : current.phone,
        updatedAt: this.now(),
      };
      const index = db.customers.findIndex((customer) => customer.id === customerId);
      db.customers[index] = next;
      return next;
    });
    this.emit("customer.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "updated",
    });
    return item;
  }
}
