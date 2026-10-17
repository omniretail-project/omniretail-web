import type {
  PackingDetailReadModel,
  PackingQueueReadModel,
} from "@/core/repositories";
import type {
  PackingDetailDto,
  PackingQueueItemDto,
} from "@/modules/logistics/application/dto/PackingReadModelDto";

export function toPackingQueueItemDto(model: PackingQueueReadModel): PackingQueueItemDto {
  return {
    packingId: model.packingId,
    ...(model.orderId ? { orderId: model.orderId } : {}),
    orderReference: model.orderReference ?? model.sourceReference,
    customerName: displayCustomerName(model),
    storePickupContact: model.storePickupContact ? { ...model.storePickupContact } : null,
    deliveryMethod: model.sourceType === "transfer" ? "transfer" : model.deliveryMethod!,
    sourceType: model.sourceType,
    sourceId: model.sourceId,
    status: model.status,
    version: model.version,
    startedAt: model.startedAt,
    updatedAt: model.updatedAt,
  };
}

export function toPackingDetailDto(model: PackingDetailReadModel): PackingDetailDto {
  return {
    ...toPackingQueueItemDto(model),
    pickingOrderId: model.pickingOrderId,
    orderStatus: model.orderStatus,
    deliveryAddress: model.deliveryAddress ? { ...model.deliveryAddress } : null,
    checklist: { ...model.checklist },
    totalWeight: model.totalWeight,
    packageCount: model.packageCount,
    labelGenerationId: model.labelGenerationId,
    labelCode: model.labelCode,
    labelGeneratedAt: model.labelGeneratedAt,
    labelPrintedAt: model.labelPrintedAt,
    finalizedAt: model.finalizedAt,
    preparedContents: model.preparedContents.map((content) => ({
      productId: content.productId,
      sku: content.sku,
      name: content.name,
      quantity: content.quantity,
      serialNumbers: [...content.serialNumbers],
      trackingSelections: content.trackingSelections.map((selection) => ({
        ...selection,
        serialNumbers: [...selection.serialNumbers],
      })),
    })),
  };
}

function displayCustomerName(model: PackingQueueReadModel): string {
  if (model.customerName?.trim()) return model.customerName.trim();
  if (model.storePickupContact?.recipientName.trim()) {
    return model.storePickupContact.recipientName.trim();
  }
  return model.sourceType === "transfer" ? "Traslado entre sucursales" : "Cliente no disponible";
}
