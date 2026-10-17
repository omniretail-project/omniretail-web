import type {
  PickingDetailReadModel,
  PickingQueueReadModel,
  PickingReadInventoryAvailability,
} from "@/core/repositories";
import type {
  PickingDetailDto,
  PickingDetailLineDto,
  PickingQueueItemDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";

export function toPickingQueueItemDto(model: PickingQueueReadModel): PickingQueueItemDto {
  return {
    pickingOrderId: model.pickingOrderId,
    ...(model.orderId ? { orderId: model.orderId } : {}),
    orderReference: model.orderReference ?? model.sourceReference,
    customerName: displayCustomerName(model),
    storePickupContact: model.storePickupContact,
    deliveryMethod: model.sourceType === "transfer" ? "transfer" : model.deliveryMethod!,
    sourceType: model.sourceType,
    sourceId: model.sourceId,
    branchId: model.branchId,
    status: model.status,
    priority: model.priority,
    assignedUserId: model.assignedUserId,
    progress: { ...model.progress },
    startedAt: model.startedAt,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

export function toPickingDetailDto(model: PickingDetailReadModel): PickingDetailDto {
  return {
    ...toPickingQueueItemDto(model),
    completedAt: model.completedAt,
    lines: model.lines.map((line): PickingDetailLineDto => ({
      pickingLineId: line.pickingLineId,
      ...(line.orderItemId ? { orderItemId: line.orderItemId } : {}),
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      requiredQuantity: line.requiredQuantity,
      pickedQuantity: line.pickedQuantity,
      remainingQuantity: line.remainingQuantity,
      status: line.status,
      location: line.location ? { ...line.location } : null,
      lot: line.lot ? { ...line.lot } : null,
      serialNumbers: [...line.serialNumbers],
      availableLocations: line.availableLocations.map((location) => ({ ...location })),
      availableLots: line.availableLots.map((lot) => ({ ...lot })),
      availableSerialNumbers: [...line.availableSerialNumbers],
      tracking: { ...line.tracking },
      inventory: toInventoryAvailability(line.inventory),
      sourceLineId: line.sourceLineId,
      trackingSelections: line.trackingSelections.map((selection) => ({
        ...selection,
        serialNumbers: [...selection.serialNumbers],
      })),
    })),
    incidents: model.incidents.map((incident) => ({ ...incident })),
    releases: model.releases.map((release) => ({ ...release })),
  };
}

function displayCustomerName(model: PickingQueueReadModel): string {
  if (model.customerName?.trim()) return model.customerName;
  if (model.storePickupContact?.recipientName.trim()) {
    return model.storePickupContact.recipientName;
  }
  return model.sourceType === "transfer" ? "Traslado entre sucursales" : "Cliente no disponible";
}

function toInventoryAvailability(model: PickingReadInventoryAvailability) {
  return {
    tenantId: model.tenantId,
    branchId: model.branchId,
    pickingOrderId: model.pickingOrderId,
    ...(model.orderId ? { orderId: model.orderId } : {}),
    productId: model.productId,
    physicalQuantity: model.physicalQuantity,
    ownReservedQuantity: model.ownReservedQuantity,
    otherReservedQuantity: model.otherReservedQuantity,
    freeQuantity: model.freeQuantity,
    usableQuantity: model.usableQuantity,
    locations: model.locations.map((location) => ({
      balanceId: location.balanceId,
      ...(location.locationId ? { locationId: location.locationId } : {}),
      ...(location.locationCode ? { locationCode: location.locationCode } : {}),
      ...(location.locationName ? { locationName: location.locationName } : {}),
      physicalQuantity: location.physicalQuantity,
      ownReservedQuantity: location.ownReservedQuantity,
      otherReservedQuantity: location.otherReservedQuantity,
      freeQuantity: location.freeQuantity,
      usableQuantity: location.usableQuantity,
      lots: location.lots.map((lot) => ({
        lotId: lot.lotId,
        lotNumber: lot.lotNumber,
        ...(lot.expirationDate ? { expirationDate: lot.expirationDate } : {}),
        physicalQuantity: lot.physicalQuantity,
        serialNumbers: lot.serialNumbers.map((serial) => ({ ...serial })),
      })),
      serialNumbers: location.serialNumbers.map((serial) => ({
        id: serial.id,
        serialNumber: serial.serialNumber,
        ...(serial.lotId ? { lotId: serial.lotId } : {}),
      })),
    })),
  };
}
