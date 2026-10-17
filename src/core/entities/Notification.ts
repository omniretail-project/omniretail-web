import type { NotificationChannel, NotificationStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface Notification {
  id: string;
  tenantId: string;
  userId?: string;
  customerId?: string;
  channel: NotificationChannel;
  type: string;
  title: string;
  message: string;
  status: NotificationStatus;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Delivery evidence is independent from the in-app read status above. */
  deliveryStatus?: "simulated_sent";
  recipientEmail?: string;
  orderId?: string;
  dispatchId?: string;
  orderReference?: string;
  carrierName?: string;
  trackingNumber?: string;
  deduplicationKey?: string;
  sentAt?: ISODateString;
  simulatedDeliveryResult?: "accepted";
  createdAt: ISODateString;
  readAt?: ISODateString;
}
