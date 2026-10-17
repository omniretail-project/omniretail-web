import type { DispatchStatus, InventoryTransferStatus } from "@/core/enums";
import type { PaginatedResult } from "@/core/types/pagination.types";

export type LogisticsHistorySourceType = "order" | "transfer";

/** Modalidad unificada del historial: incluye `transfer` para los traslados entre sucursales. */
export type LogisticsHistoryDeliveryMethod =
  | "immediate"
  | "store_pickup"
  | "home_delivery"
  | "transfer";

/**
 * Fila del historial tal como la entrega `GET /logistics/history`. `operationalStatus` es el
 * nombre de un `OrderStatus` (pedidos) o de un `InventoryTransferStatus` (traslados).
 */
export interface LogisticsHistoryRowReadModel {
  sourceType: LogisticsHistorySourceType;
  sourceId: string;
  orderId: string | null;
  orderReference: string;
  deliveryMethod: LogisticsHistoryDeliveryMethod;
  operationalStatus: string;
  contactName: string | null;
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

export interface LogisticsHistoryTraceSelectionReadModel {
  locationId: string;
  lotId: string | null;
  lotNumber: string | null;
  expirationDate: string | null;
  quantity: number;
  serialNumbers: string[];
}

/**
 * Las cantidades empacada y despachada pueden ser derivadas de las etapas operativas; `null`
 * indica que la etapa aún no registra información (distinto de una cantidad 0).
 */
export interface LogisticsHistoryLineReadModel {
  productId: string;
  productName: string;
  requestedQuantity: number;
  pickedQuantity: number;
  packedQuantity: number | null;
  dispatchedQuantity: number | null;
  trackingSelections: LogisticsHistoryTraceSelectionReadModel[];
}

export interface LogisticsHistoryPackageReadModel {
  id: string;
  number: string;
  weight: number | null;
  description: string | null;
}

export interface LogisticsHistoryDetailReadModel {
  summary: LogisticsHistoryRowReadModel;
  lines: LogisticsHistoryLineReadModel[];
  packages: LogisticsHistoryPackageReadModel[];
}

export interface LogisticsHistorySearchQuery {
  branchId: string;
  search?: string;
  /** Nombre de un `OrderStatus` o `InventoryTransferStatus`. */
  status?: string;
  /**
   * Estado equivalente para los traslados (p. ej. `dispatched` ↔ `inTransit`). Requiere el
   * parámetro `transferStatus` en el backend; mientras no exista, el backend lo ignora.
   */
  transferStatus?: InventoryTransferStatus;
  deliveryMethod?: LogisticsHistoryDeliveryMethod;
  /** Fecha `YYYY-MM-DD` inclusiva; filtra por creación del Picking en la zona del tenant. */
  from?: string;
  to?: string;
  /** Página desde 1, como `PaginatedResult`. */
  page: number;
  pageSize: number;
}

export interface LogisticsHistoryReadRepository {
  search(query: LogisticsHistorySearchQuery): Promise<PaginatedResult<LogisticsHistoryRowReadModel>>;
  getDetail(
    branchId: string,
    sourceType: LogisticsHistorySourceType,
    sourceId: string,
  ): Promise<LogisticsHistoryDetailReadModel>;
}
