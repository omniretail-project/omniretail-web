import type { TenantSubscriptionRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

/**
 * `create`/`update` emiten `tenant-subscription.changed` (mismo criterio que el resto de los Mock
 * repositories: el evento se emite en infraestructura, nunca en el Application Service).
 */
export class MockTenantSubscriptionRepository
  extends BaseMockRepository
  implements TenantSubscriptionRepository
{
  async listInvoices(tenantId: string) {
    return this.read((db) => db.subscriptionInvoices
      .filter((invoice) => invoice.tenantId === tenantId)
      .sort((a, b) => b.cycleStart.localeCompare(a.cycleStart)));
  }

  async ensureInvoice(input: Parameters<TenantSubscriptionRepository["ensureInvoice"]>[0]) {
    return this.store.mutate((db) => {
      const subscription = db.tenantSubscriptions.find((item) => item.tenantId === input.tenantId);
      if (!subscription) throw this.missing("TenantSubscription", input.tenantId);
      const existing = db.subscriptionInvoices.find(
        (invoice) => invoice.tenantId === input.tenantId && invoice.cycleStart === input.cycleStart,
      );
      if (existing) return existing;
      db.subscriptionInvoices.push(input);
      return input;
    });
  }
  async getByTenantId(tenantId: string) {
    return this.read(
      (db) => db.tenantSubscriptions.find((item) => item.tenantId === tenantId) ?? null,
    );
  }
  async create(input: Parameters<TenantSubscriptionRepository["create"]>[0]) {
    const created = this.store.mutate((db) => {
      const now = this.now();
      const item = { ...input, id: this.id("tenant-subscription"), createdAt: now, updatedAt: now };
      db.tenantSubscriptions.push(item);
      return item;
    });
    this.emit("tenant-subscription.changed", {
      entityId: created.id,
      tenantId: created.tenantId,
      action: "created",
    });
    return created;
  }
  async update(tenantId: string, input: Parameters<TenantSubscriptionRepository["update"]>[1]) {
    const updated = this.store.mutate((db) => {
      const index = db.tenantSubscriptions.findIndex((item) => item.tenantId === tenantId);
      if (index < 0) throw this.missing("TenantSubscription", tenantId);
      db.tenantSubscriptions[index] = {
        ...db.tenantSubscriptions[index],
        ...input,
        updatedAt: this.now(),
      };
      return db.tenantSubscriptions[index];
    });
    this.emit("tenant-subscription.changed", {
      entityId: updated.id,
      tenantId: updated.tenantId,
      action: "updated",
    });
    return updated;
  }
}
