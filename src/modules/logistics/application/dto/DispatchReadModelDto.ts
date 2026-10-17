import type { DispatchNotificationStatus } from "@/core/repositories";
import type {
  DispatchStatus,
  InventoryTransferStatus,
  OrderStatus,
  PackingStatus,
  PickingStatus,
  TransportMode,
} from "@/core/enums";

export interface DispatchAddressDto {
  recipientName: string;
  recipientPhone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  stateOrDepartment: string | null;
  postalCode: string | null;
  country: string;
  references: string | null;
}

export type DispatchNotificationContactDto =
  | { emailMode: "send"; email: string }
  | { emailMode: "not_applicable" }
  | { emailMode: "legacy_unknown" };

export interface PreparedOrderQueueItemDto {
  orderId: string;
  orderReference: string;
  createdAt: string;
  recipientName: string;
  recipientPhone: string | null;
  address: DispatchAddressDto | null;
  transportMode: TransportMode;
  notificationContact: DispatchNotificationContactDto;
  pickingOrderId: string;
  pickingCompletedAt: string;
}

export interface PreparedOrderDetailDto extends PreparedOrderQueueItemDto {
  orderStatus: OrderStatus;
  pickingStatus: "completed";
}

export interface DispatchQueueItemDto {
  orderId: string | null;
  orderReference: string | null;
  createdAt: string;
  transportMode: TransportMode;
  packingId: string;
  packingFinalizedAt: string;
  sourceType: "order" | "transfer";
  sourceId: string;
  sourceReference: string;
}

export interface PreparedDispatchDetailDto {
  orderId: string;
  orderReference: string;
  createdAt: string;
  orderStatus: OrderStatus;
  recipientName: string | null;
  recipientPhone: string | null;
  address: PreparedDispatchAddressDto | null;
  notificationContact: DispatchNotificationContactDto;
  transportMode: TransportMode;
  pickingOrderId: string;
  pickingStatus: PickingStatus;
  pickingCompletedAt: string;
  packingId: string;
  packingStatus: PackingStatus;
  packingFinalizedAt: string;
  packageCount: number;
  totalWeight: number;
  labelCode: string;
}

export interface PreparedDispatchAddressDto {
  recipientName: string | null;
  recipientPhone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  stateOrDepartment: string | null;
  postalCode: string | null;
  country: string | null;
  references: string | null;
}

export interface ApiDispatchResultDto {
  orderId: string | null;
  orderStatus: OrderStatus | null;
  dispatchId: string;
  dispatchStatus: DispatchStatus;
  transportMode: TransportMode;
  carrierName: string | null;
  trackingNumber: string | null;
  dispatchedAt: string;
  packages: DispatchPackageDto[];
  idempotent: boolean;
  sourceType: "order" | "transfer";
  sourceId: string;
  sourceReference: string | null;
  transferStatus: InventoryTransferStatus | null;
}

export interface DispatchNotificationDto {
  id: string;
  recipientEmail: string;
  deliveryStatus: "simulated_sent";
  sentAt: string;
}

export interface DispatchPackageDto {
  id: string;
  number: string;
  weight: number | null;
  description: string | null;
}

export interface ConfirmDispatchPackageDto {
  number: string;
  weight?: number;
  description?: string;
}

export interface DispatchDetailDto extends PreparedOrderDetailDto {
  dispatch: {
    id: string;
    status: DispatchStatus;
    carrierName: string | null;
    trackingNumber: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    dispatchedByUserId: string | null;
  } | null;
  notification: DispatchNotificationDto | null;
  packages: DispatchPackageDto[];
}

export interface ConfirmDispatchCommand {
  orderId: string;
  operationId: string;
  carrierName?: string;
  trackingNumber?: string;
  packages?: ConfirmDispatchPackageDto[];
}

export interface ConfirmDispatchResultDto {
  orderId: string;
  orderStatus: OrderStatus;
  dispatchId: string;
  dispatchStatus: DispatchStatus;
  transportMode: TransportMode;
  carrierName: string | null;
  trackingNumber: string | null;
  dispatchedAt: string;
  notificationStatus: DispatchNotificationStatus;
  notification: DispatchNotificationDto | null;
  packages: DispatchPackageDto[];
  idempotent: boolean;
}

export interface MarkDispatchDeliveredCommand {
  orderId: string;
}

export interface MarkDispatchDeliveredResultDto {
  orderId: string;
  orderStatus: OrderStatus;
  dispatchId: string;
  dispatchStatus: DispatchStatus;
  deliveredAt: string;
  idempotent: boolean;
}
