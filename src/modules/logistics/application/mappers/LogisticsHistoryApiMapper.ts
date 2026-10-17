import { DeliveryMethod, InventoryTransferStatus, OrderStatus } from "@/core/enums";
import type {
  LogisticsHistoryDeliveryMethod,
  LogisticsHistoryDetailReadModel,
  LogisticsHistoryLineReadModel,
  LogisticsHistoryRowReadModel,
} from "@/core/repositories";
import type {
  LogisticsHistoryDetailDto,
  LogisticsHistoryItemDto,
} from "@/modules/logistics/application/dto/LogisticsHistoryDto";
import type {
  LogisticsItemTraceDto,
  LogisticsTraceAllocationDto,
} from "@/modules/logistics/application/dto/LogisticsItemTraceDto";

/** Mismo prefijo que usa el historial mock para identificar traslados en la tabla. */
export const TRANSFER_HISTORY_PREFIX = "transfer:";

const deliveryMethods: Record<LogisticsHistoryDeliveryMethod, LogisticsHistoryItemDto["deliveryMethod"]> = {
  immediate: DeliveryMethod.immediate,
  store_pickup: DeliveryMethod.store_pickup,
  home_delivery: DeliveryMethod.home_delivery,
  transfer: "transfer",
};

/**
 * La pantalla presenta los traslados con la semántica de un pedido (como el historial mock):
 * recibido = entregado, en tránsito = despachado.
 */
const transferStatuses: Record<InventoryTransferStatus, OrderStatus> = {
  [InventoryTransferStatus.preparing]: OrderStatus.preparing,
  [InventoryTransferStatus.inTransit]: OrderStatus.dispatched,
  [InventoryTransferStatus.received]: OrderStatus.delivered,
  [InventoryTransferStatus.cancelled]: OrderStatus.cancelled,
};

const orderStatuses = new Set<string>(Object.values(OrderStatus));

/**
 * Inverso de `transferStatuses` para los filtros: "Despachado" también debe traer los traslados
 * en tránsito y "Entregado" los recibidos. Los estados sin equivalente solo filtran pedidos.
 */
const transferStatusByOrderStatus: Partial<Record<OrderStatus, InventoryTransferStatus>> = {
  [OrderStatus.dispatched]: InventoryTransferStatus.inTransit,
  [OrderStatus.delivered]: InventoryTransferStatus.received,
  [OrderStatus.cancelled]: InventoryTransferStatus.cancelled,
  [OrderStatus.preparing]: InventoryTransferStatus.preparing,
};

export function toLogisticsHistoryStatusQuery(status: "all" | OrderStatus): {
  status?: OrderStatus;
  transferStatus?: InventoryTransferStatus;
} {
  if (status === "all") return {};
  return { status, transferStatus: transferStatusByOrderStatus[status] };
}

export function toLogisticsHistoryItemDto(row: LogisticsHistoryRowReadModel): LogisticsHistoryItemDto {
  const isTransfer = row.sourceType === "transfer";
  return {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    orderId: row.orderId ?? `${TRANSFER_HISTORY_PREFIX}${row.sourceId}`,
    orderReference: isTransfer ? `Traslado ${row.orderReference}` : row.orderReference,
    deliveryMethod: deliveryMethods[row.deliveryMethod],
    operationalStatus: toOperationalStatus(row),
    contactName: row.contactName?.trim() || (isTransfer ? "Sucursal destino" : "Cliente"),
    contactPhone: row.contactPhone,
    pickingOrderId: row.pickingOrderId,
    packingId: row.packingId,
    dispatchId: row.dispatchId,
    storePickupDeliveryId: row.storePickupDeliveryId,
    pickingCompletedAt: row.pickingCompletedAt,
    packingFinalizedAt: row.packingFinalizedAt,
    dispatchedAt: row.dispatchedAt,
    deliveredAt: row.deliveredAt,
    responsibleUserId: row.responsibleUserId,
    responsibleUserName: row.responsibleUserName,
    totalWeight: row.totalWeight,
    packageCount: row.packageCount,
    dispatchStatus: row.dispatchStatus,
    carrierName: row.carrierName,
    trackingNumber: row.trackingNumber,
  };
}

export function toLogisticsHistoryDetailDto(
  detail: LogisticsHistoryDetailReadModel,
): LogisticsHistoryDetailDto {
  return {
    summary: toLogisticsHistoryItemDto(detail.summary),
    items: detail.lines.map((line, index) => toLogisticsItemTraceDto(line, index)),
  };
}

function toOperationalStatus(row: LogisticsHistoryRowReadModel): OrderStatus {
  if (row.sourceType === "transfer" && row.operationalStatus in transferStatuses) {
    return transferStatuses[row.operationalStatus as InventoryTransferStatus];
  }
  if (orderStatuses.has(row.operationalStatus)) return row.operationalStatus as OrderStatus;
  throw new Error(`Estado operativo no reconocido en el historial: ${row.operationalStatus}`);
}

/**
 * El backend no expone el SKU ni el código de ubicación en el historial: se dejan vacíos y la
 * vista los omite. Las series se presentan una por fila, como la trazabilidad del mock.
 */
function toLogisticsItemTraceDto(
  line: LogisticsHistoryLineReadModel,
  index: number,
): LogisticsItemTraceDto {
  const lineKey = `${line.productId}-${index}`;
  return {
    pickingItemId: lineKey,
    orderItemId: lineKey,
    productId: line.productId,
    sku: "",
    name: line.productName,
    requestedQuantity: line.requestedQuantity,
    pickedQuantity: line.pickedQuantity,
    packedQuantity: line.packedQuantity,
    dispatchedQuantity: line.dispatchedQuantity,
    allocations: line.trackingSelections.flatMap((selection): LogisticsTraceAllocationDto[] => {
      const base = {
        reservationId: "",
        location: { id: selection.locationId, code: "", name: "" },
        lot: selection.lotId
          ? {
              id: selection.lotId,
              number: selection.lotNumber ?? "",
              expiresAt: selection.expirationDate,
            }
          : null,
      };
      if (selection.serialNumbers.length === 0) {
        return [{ ...base, quantity: selection.quantity, serial: null }];
      }
      return selection.serialNumbers.map((serialNumber) => ({
        ...base,
        quantity: 1,
        serial: { id: serialNumber, number: serialNumber },
      }));
    }),
  };
}
