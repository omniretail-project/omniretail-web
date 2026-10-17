import type { Order, StorePickupDelivery } from "@/core/entities";

export interface StorePickupDeliveryScope {
  tenantId: string;
  branchId: string;
}

export interface ConfirmStorePickupDeliveryInput extends StorePickupDeliveryScope {
  actorUserId: string;
  orderId: string;
  operationId: string;
}

export interface ConfirmStorePickupDeliveryResult {
  order: Order;
  delivery: StorePickupDelivery;
  idempotent: boolean;
}

export interface StorePickupDeliveryRepository {
  getByOrder(scope: StorePickupDeliveryScope, orderId: string): Promise<StorePickupDelivery | null>;
  confirm(input: ConfirmStorePickupDeliveryInput): Promise<ConfirmStorePickupDeliveryResult>;
}
