import type { DeliveryMethod, DispatchStatus, OrderStatus } from "@/core/enums";
import type { LogisticsItemTraceDto } from "@/modules/logistics/application/dto/LogisticsItemTraceDto";

export interface LogisticsHistoryItemDto {
  sourceType: "order" | "transfer";
  sourceId: string;
  orderId: string;
  orderReference: string;
  deliveryMethod: DeliveryMethod | "transfer";
  operationalStatus: OrderStatus;
  contactName: string;
  contactPhone: string | null;
  pickingOrderId: string | null;
  packingId: string | null;
  dispatchId: string | null;
  storePickupDeliveryId: string | null;
  pickingCompletedAt: string | null;
  packingFinalizedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  totalWeight: number | null;
  packageCount: number | null;
  dispatchStatus: DispatchStatus | null;
  carrierName: string | null;
  trackingNumber: string | null;
}

export interface LogisticsHistoryDetailDto {
  summary: LogisticsHistoryItemDto;
  items: LogisticsItemTraceDto[];
}

/** Filtros de la pantalla; en modo API se resuelven en el backend. */
export interface LogisticsHistoryQueryDto {
  search: string;
  status: "all" | OrderStatus;
  deliveryMethod: "all" | DeliveryMethod.home_delivery | DeliveryMethod.store_pickup;
  from: string;
  to: string;
}

export interface LogisticsHistoryPageDto {
  items: LogisticsHistoryItemDto[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
