import type {
  DispatchStatus,
  InventoryTransferStatus,
  OrderStatus,
  PackingStatus,
  PickingStatus,
  TransportMode,
} from "@/core/enums";

export interface DispatchApiReadScope {
  tenantId: string;
  branchId: string;
}

export interface DispatchQueueReadModel {
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

export interface PreparedDispatchAddressReadModel {
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

export type PreparedDispatchNotificationReadModel = Record<string, unknown> | null;

export interface PreparedDispatchReadModel {
  orderId: string;
  orderReference: string;
  createdAt: string;
  orderStatus: OrderStatus;
  recipientName: string | null;
  recipientPhone: string | null;
  deliveryAddress: PreparedDispatchAddressReadModel | null;
  notificationContact: PreparedDispatchNotificationReadModel;
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

export interface DispatchPackageReadModel {
  id: string;
  number: string;
  weight: number | null;
  description: string | null;
}

export interface DispatchResultReadModel {
  orderId: string | null;
  orderStatus: OrderStatus | null;
  dispatchId: string;
  dispatchStatus: DispatchStatus;
  transportMode: TransportMode;
  carrierName: string | null;
  trackingNumber: string | null;
  dispatchedAt: string;
  packages: DispatchPackageReadModel[];
  idempotent: boolean;
  sourceType: "order" | "transfer";
  sourceId: string;
  sourceReference: string | null;
  transferStatus: InventoryTransferStatus | null;
}

/** Proyecciones autoritativas de Dispatch; tenant y actor se derivan de la sesion. */
export interface DispatchReadRepository {
  getQueue(scope: DispatchApiReadScope): Promise<DispatchQueueReadModel[]>;
  getPreparedDetail(scope: DispatchApiReadScope, orderId: string): Promise<PreparedDispatchReadModel>;
  getDetail(scope: DispatchApiReadScope, orderId: string): Promise<DispatchResultReadModel>;
  getTransferDetail(scope: DispatchApiReadScope, transferId: string): Promise<DispatchResultReadModel>;
}
