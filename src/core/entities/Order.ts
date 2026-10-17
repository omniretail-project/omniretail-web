import type { DeliveryMethod, OrderSource, OrderStatus, TransportMode } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";
import type { AddressSnapshot } from "@/core/types/address.types";
import type { OrderNotificationContact } from "@/core/types/orderNotification.types";
import type { StorePickupContactSnapshot } from "@/core/types/storePickupContact.types";
import type { OrderItem } from "@/core/entities/OrderItem";

export interface GuestCustomer {
  name: string;
  email: string;
}

export interface Order {
  id: string;
  tenantId: string;
  branchId: string;
  orderNumber: string;
  source: OrderSource;
  customerId?: string;
  guestCustomer?: GuestCustomer;
  items: OrderItem[];
  status: OrderStatus;
  deliveryMethod: DeliveryMethod;
  transportMode: TransportMode;
  deliveryAddress?: AddressSnapshot;
  storePickupContact?: StorePickupContactSnapshot;
  /** Historical notification intent captured when the Order is created. Undefined is legacy. */
  notificationContact?: OrderNotificationContact;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  total: number;
  trackingToken: string;
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
