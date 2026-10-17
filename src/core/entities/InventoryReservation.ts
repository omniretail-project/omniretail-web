import type { InventoryReservationStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface InventoryReservationAllocation {
  id: string;
  balanceId: string;
  locationId?: string;
  reservedQuantity: number;
  consumedQuantity: number;
}

export interface InventoryReservation {
  id: string;
  tenantId: string;
  branchId: string;
  orderId?: string;
  orderItemId: string;
  sourceType?: "order" | "transfer";
  sourceId?: string;
  productId: string;
  status: InventoryReservationStatus;
  allocations: InventoryReservationAllocation[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface InventoryReservationConsumedAllocation {
  balanceId: string;
  quantity: number;
}

export interface InventoryReservationConsumeOperation {
  id: string;
  tenantId: string;
  branchId: string;
  reservationId: string;
  operationId: string;
  fingerprint: string;
  allocationsConsumed: InventoryReservationConsumedAllocation[];
  inventoryMovementIds: string[];
  resultReservation: InventoryReservation;
  performedByUserId: string;
  createdAt: ISODateString;
}
