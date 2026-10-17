import { NotificationStatus } from "@/core/enums";
import type { NotificationRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockNotificationRepository
  extends BaseMockRepository
  implements NotificationRepository
{
  async getAll(tenantId: string) {
    return this.read((db) => db.notifications.filter((item) => item.tenantId === tenantId));
  }
  async getByDispatch(tenantId: string, dispatchId: string) {
    return this.read(
      (db) =>
        db.notifications.find(
          (item) => item.tenantId === tenantId && item.dispatchId === dispatchId,
        ) ?? null,
    );
  }
  async getByUser(userId: string) {
    return this.read((db) => db.notifications.filter((item) => item.userId === userId));
  }
  async getByCustomer(customerId: string) {
    return this.read((db) => db.notifications.filter((item) => item.customerId === customerId));
  }
  async create(input: Parameters<NotificationRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("notifications"), createdAt: now };
      db.notifications.push(created);
      return created;
    });
    this.emit("notification.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "created",
    });
    return item;
  }
  async markAsRead(id: string) {
    const item = this.store.mutate((db) =>
      this.updateById(
        db.notifications,
        id,
        { status: NotificationStatus.read, readAt: this.now() },
        "Notification",
      ),
    );
    this.emit("notification.changed", {
      entityId: item.id,
      tenantId: "tenantId" in item ? item.tenantId : undefined,
      action: "updated",
    });
    return item;
  }
}
