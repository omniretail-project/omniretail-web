import { DeliveryMethod, OrderSource } from "@/core/enums";

const allowedDeliveryMethodsBySource: Record<OrderSource, ReadonlySet<DeliveryMethod>> = {
  [OrderSource.ecommerce]: new Set([DeliveryMethod.home_delivery]),
  [OrderSource.mobileApp]: new Set([DeliveryMethod.home_delivery]),
  [OrderSource.pos]: new Set([
    DeliveryMethod.immediate,
    DeliveryMethod.store_pickup,
    DeliveryMethod.home_delivery,
  ]),
};

export function isOrderDeliveryMethodAllowed(
  source: OrderSource,
  deliveryMethod: DeliveryMethod,
): boolean {
  return allowedDeliveryMethodsBySource[source]?.has(deliveryMethod) ?? false;
}

export function assertOrderDeliveryMethodAllowed(
  source: OrderSource,
  deliveryMethod: DeliveryMethod,
): void {
  if (!isOrderDeliveryMethodAllowed(source, deliveryMethod)) {
    throw new Error(`Order delivery method ${deliveryMethod} is not allowed for source ${source}`);
  }
}
