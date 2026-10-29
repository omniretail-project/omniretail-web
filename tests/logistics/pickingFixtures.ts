import { PickingItemStatus, PickingPriority, PickingStatus, DeliveryMethod } from "@/core/enums";
import type {
  PickingDetailDto,
  PickingDetailLineDto,
  PickingQueueItemDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";

export const pickingIds = {
  tenant: "20000000-0000-4000-8000-000000000001",
  branch: "20000000-0000-4000-8000-000000000002",
  picking: "20000000-0000-4000-8000-000000000003",
  order: "20000000-0000-4000-8000-000000000004",
  user: "20000000-0000-4000-8000-000000000005",
};

/** Linea sin trazabilidad (ni lote, ni vencimiento, ni serie): la mas simple de operar. */
export function plainLine(
  key: string,
  overrides: Partial<PickingDetailLineDto> = {},
): PickingDetailLineDto {
  const required = overrides.requiredQuantity ?? 10;
  const picked = overrides.pickedQuantity ?? 0;
  return {
    pickingLineId: `30000000-0000-4000-8000-${key.padStart(12, "0")}`,
    orderItemId: `40000000-0000-4000-8000-${key.padStart(12, "0")}`,
    productId: `50000000-0000-4000-8000-${key.padStart(12, "0")}`,
    sku: `SKU-${key}`,
    name: `Producto ${key}`,
    requiredQuantity: required,
    pickedQuantity: picked,
    remainingQuantity: required - picked,
    status: picked >= required ? PickingItemStatus.completed : picked > 0 ? PickingItemStatus.partial : PickingItemStatus.pending,
    location: null,
    lot: null,
    serialNumbers: [],
    availableLocations: [],
    availableLots: [],
    availableSerialNumbers: [],
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    inventory: {
      tenantId: pickingIds.tenant,
      branchId: pickingIds.branch,
      pickingOrderId: pickingIds.picking,
      orderId: pickingIds.order,
      productId: `50000000-0000-4000-8000-${key.padStart(12, "0")}`,
      physicalQuantity: 100,
      ownReservedQuantity: required,
      otherReservedQuantity: 0,
      freeQuantity: 90,
      usableQuantity: 100,
      locations: [],
    },
    sourceLineId: `40000000-0000-4000-8000-${key.padStart(12, "0")}`,
    trackingSelections: [],
    ...overrides,
  };
}

export function pickingDetail(lines: PickingDetailLineDto[], overrides: Partial<PickingDetailDto> = {}): PickingDetailDto {
  const required = lines.reduce((total, line) => total + line.requiredQuantity, 0);
  const picked = lines.reduce((total, line) => total + line.pickedQuantity, 0);
  return {
    pickingOrderId: pickingIds.picking,
    orderId: pickingIds.order,
    orderReference: "ORD-900",
    customerName: "Cliente",
    storePickupContact: null,
    deliveryMethod: DeliveryMethod.home_delivery,
    branchId: pickingIds.branch,
    status: PickingStatus.in_progress,
    priority: PickingPriority.normal,
    assignedUserId: pickingIds.user,
    progress: {
      requiredQuantity: required,
      pickedQuantity: picked,
      remainingQuantity: required - picked,
      percentage: required === 0 ? 0 : Math.round((picked / required) * 100),
    },
    startedAt: "2026-10-20T10:00:00Z",
    completedAt: null,
    createdAt: "2026-10-20T09:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    lines,
    incidents: [],
    releases: [],
    ...overrides,
  };
}

export function queueItem(detail: PickingDetailDto): PickingQueueItemDto {
  return {
    pickingOrderId: detail.pickingOrderId,
    orderId: detail.orderId,
    orderReference: detail.orderReference,
    customerName: detail.customerName,
    storePickupContact: null,
    deliveryMethod: detail.deliveryMethod,
    branchId: detail.branchId,
    status: detail.status,
    priority: detail.priority,
    assignedUserId: detail.assignedUserId,
    progress: detail.progress,
    startedAt: detail.startedAt,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}
