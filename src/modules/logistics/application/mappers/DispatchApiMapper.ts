import type {
  DispatchQueueReadModel,
  DispatchResultReadModel,
  PreparedDispatchReadModel,
} from "@/core/repositories";
import type {
  DispatchQueueItemDto,
  PreparedDispatchDetailDto,
  ApiDispatchResultDto,
} from "@/modules/logistics/application/dto/DispatchReadModelDto";

export function toDispatchQueueItemDto(model: DispatchQueueReadModel): DispatchQueueItemDto {
  return { ...model };
}

export function toPreparedDispatchDetailDto(
  model: PreparedDispatchReadModel,
): PreparedDispatchDetailDto {
  return {
    orderId: model.orderId,
    orderReference: model.orderReference,
    createdAt: model.createdAt,
    orderStatus: model.orderStatus,
    recipientName: model.recipientName,
    recipientPhone: model.recipientPhone,
    address: model.deliveryAddress ? { ...model.deliveryAddress } : null,
    notificationContact: toNotificationContact(model.notificationContact),
    transportMode: model.transportMode,
    pickingOrderId: model.pickingOrderId,
    pickingStatus: model.pickingStatus,
    pickingCompletedAt: model.pickingCompletedAt,
    packingId: model.packingId,
    packingStatus: model.packingStatus,
    packingFinalizedAt: model.packingFinalizedAt,
    packageCount: model.packageCount,
    totalWeight: model.totalWeight,
    labelCode: model.labelCode,
  };
}

export function toApiDispatchResultDto(model: DispatchResultReadModel): ApiDispatchResultDto {
  return {
    ...model,
    packages: model.packages.map((item) => ({ ...item })),
  };
}

function toNotificationContact(
  value: PreparedDispatchReadModel["notificationContact"],
): PreparedDispatchDetailDto["notificationContact"] {
  if (value?.emailMode === "send" && typeof value.email === "string" && value.email.length > 0) {
    return { emailMode: "send", email: value.email };
  }
  if (value?.emailMode === "not_applicable") return { emailMode: "not_applicable" };
  return { emailMode: "legacy_unknown" };
}
