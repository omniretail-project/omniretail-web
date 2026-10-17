import type { Dispatch, Notification, Order, Package } from "@/core/entities";

export interface DispatchReadScope {
  tenantId: string;
  branchId?: string;
}

export interface ConfirmDispatchInput {
  tenantId: string;
  branchId: string;
  actorUserId: string;
  orderId: string;
  operationId: string;
  carrierName?: string;
  trackingNumber?: string;
}

export type DispatchNotificationStatus =
  "simulated_sent" | "not_applicable" | "legacy_unknown_skipped";

export interface ConfirmDispatchResult {
  dispatch: Dispatch;
  order: Order;
  notification?: Notification;
  notificationStatus: DispatchNotificationStatus;
  packages: Package[];
  idempotent: boolean;
}

export interface MarkDispatchDeliveredInput {
  tenantId: string;
  branchId: string;
  actorUserId: string;
  orderId: string;
}

export interface MarkDispatchDeliveredResult {
  dispatch: Dispatch;
  order: Order;
  idempotent: boolean;
}

export interface DispatchRepository {
  getAll(scope: DispatchReadScope): Promise<Dispatch[]>;
  getById(scope: DispatchReadScope, id: string): Promise<Dispatch | null>;
  getByOrder(scope: DispatchReadScope, orderId: string): Promise<Dispatch | null>;
  getPackagesByDispatch(scope: DispatchReadScope, dispatchId: string): Promise<Package[]>;
  confirm(input: ConfirmDispatchInput): Promise<ConfirmDispatchResult>;
  markDelivered(input: MarkDispatchDeliveredInput): Promise<MarkDispatchDeliveredResult>;
}
