import type { BankAccountRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockBankAccountRepository extends BaseMockRepository implements BankAccountRepository {
  async getAll() {
    return this.read((db) => db.bankAccounts);
  }
  async getById(id: string) {
    return this.read((db) => db.bankAccounts.find((item) => item.id === id) ?? null);
  }
  async getActive() {
    return this.read((db) => db.bankAccounts.filter((item) => item.status === "active"));
  }
  async getActiveByTenant(tenantId: string) {
    return this.read((db) =>
      db.bankAccounts.filter((item) => item.status === "active" && item.tenantId === tenantId),
    );
  }
  async create(input: Parameters<BankAccountRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("bankAccounts"), createdAt: now, updatedAt: now };
      db.bankAccounts.push(created);
      return created;
    });
    this.emit("payment.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }
  async update(id: string, input: Parameters<BankAccountRepository["update"]>[1]) {
    const item = this.store.mutate((db) =>
      this.updateById(db.bankAccounts, id, input, "BankAccount"),
    );
    this.emit("payment.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "updated",
    });
    return item;
  }
}
