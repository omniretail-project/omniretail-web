import type {
  DispatchQueueReadModel,
  DispatchResultReadModel,
  PreparedDispatchReadModel,
} from "@/core/repositories";
import {
  DispatchStatus,
  InventoryTransferStatus,
  OrderStatus,
  PackingStatus,
  PickingStatus,
  TransportMode,
} from "@/core/enums";
import type {
  DispatchQueueItemDto,
  PreparedDispatchDetailDto,
} from "@/modules/logistics/application/dto/DispatchReadModelDto";

export const id = (suffix: number) =>
  `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

export const ids = {
  branchA: id(1),
  branchB: id(2),
  order: id(3),
  transfer: id(4),
  packing: id(5),
  picking: id(6),
  dispatch: id(7),
  dispatchPackage: id(8),
  tenant: id(9),
  user: id(10),
  role: id(11),
};

export const orderQueueModel: DispatchQueueReadModel = {
  orderId: ids.order,
  orderReference: "ORD-100",
  createdAt: "2026-10-08T14:00:00Z",
  transportMode: TransportMode.third_party,
  packingId: ids.packing,
  packingFinalizedAt: "2026-10-08T15:00:00Z",
  sourceType: "order",
  sourceId: ids.order,
  sourceReference: "ORD-100",
};

export const transferQueueModel: DispatchQueueReadModel = {
  orderId: null,
  orderReference: null,
  createdAt: "2026-10-08T14:10:00Z",
  transportMode: TransportMode.own_fleet,
  packingId: id(12),
  packingFinalizedAt: "2026-10-08T15:10:00Z",
  sourceType: "transfer",
  sourceId: ids.transfer,
  sourceReference: "TRF-100",
};

export const queueDtos: DispatchQueueItemDto[] = [orderQueueModel, transferQueueModel];

export const preparedModel: PreparedDispatchReadModel = {
  orderId: ids.order,
  orderReference: "ORD-100",
  createdAt: "2026-10-08T14:00:00Z",
  orderStatus: OrderStatus.ready_for_dispatch,
  recipientName: null,
  recipientPhone: null,
  deliveryAddress: {
    recipientName: null,
    recipientPhone: null,
    line1: "Zona 1",
    line2: null,
    city: "Guatemala",
    stateOrDepartment: null,
    postalCode: null,
    country: "GT",
    references: null,
  },
  notificationContact: { emailMode: "send", email: "customer@example.com" },
  transportMode: TransportMode.third_party,
  pickingOrderId: ids.picking,
  pickingStatus: PickingStatus.completed,
  pickingCompletedAt: "2026-10-08T14:30:00Z",
  packingId: ids.packing,
  packingStatus: PackingStatus.finalized,
  packingFinalizedAt: "2026-10-08T15:00:00Z",
  packageCount: 2,
  totalWeight: 3.125,
  labelCode: "LBL-ORD-100",
};

export const preparedDto: PreparedDispatchDetailDto = {
  orderId: preparedModel.orderId,
  orderReference: preparedModel.orderReference,
  createdAt: preparedModel.createdAt,
  orderStatus: preparedModel.orderStatus,
  recipientName: preparedModel.recipientName,
  recipientPhone: preparedModel.recipientPhone,
  address: preparedModel.deliveryAddress,
  notificationContact: { emailMode: "send", email: "customer@example.com" },
  transportMode: preparedModel.transportMode,
  pickingOrderId: preparedModel.pickingOrderId,
  pickingStatus: preparedModel.pickingStatus,
  pickingCompletedAt: preparedModel.pickingCompletedAt,
  packingId: preparedModel.packingId,
  packingStatus: preparedModel.packingStatus,
  packingFinalizedAt: preparedModel.packingFinalizedAt,
  packageCount: preparedModel.packageCount,
  totalWeight: preparedModel.totalWeight,
  labelCode: preparedModel.labelCode,
};

export const orderResult: DispatchResultReadModel = {
  orderId: ids.order,
  orderStatus: OrderStatus.dispatched,
  dispatchId: ids.dispatch,
  dispatchStatus: DispatchStatus.dispatched,
  transportMode: TransportMode.third_party,
  carrierName: "Carrier",
  trackingNumber: "TRACK-1",
  dispatchedAt: "2026-10-08T16:00:00Z",
  packages: [{
    id: ids.dispatchPackage,
    number: "PKG-1",
    weight: 3.125,
    description: null,
  }],
  idempotent: false,
  sourceType: "order",
  sourceId: ids.order,
  sourceReference: "ORD-100",
  transferStatus: null,
};

export const transferResult: DispatchResultReadModel = {
  ...orderResult,
  orderId: null,
  orderStatus: null,
  transportMode: TransportMode.own_fleet,
  carrierName: null,
  trackingNumber: null,
  sourceType: "transfer",
  sourceId: ids.transfer,
  sourceReference: "TRF-100",
  transferStatus: InventoryTransferStatus.inTransit,
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
