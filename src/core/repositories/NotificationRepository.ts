import type { Notification } from "@/core/entities";
export interface NotificationRepository {
  getAll(tenantId: string): Promise<Notification[]>;
  getByDispatch(tenantId: string, dispatchId: string): Promise<Notification | null>;
  getByUser(userId: string): Promise<Notification[]>;
  getByCustomer(customerId: string): Promise<Notification[]>;
  create(input: Omit<Notification, "id" | "createdAt">): Promise<Notification>;
  markAsRead(id: string): Promise<Notification>;
}
