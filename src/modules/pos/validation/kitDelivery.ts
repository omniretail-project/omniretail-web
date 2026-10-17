import { DeliveryMethod } from "@/core/enums";

/**
 * El backend rechaza los kits en ventas diferidas (`KIT_FULFILLMENT_NOT_SUPPORTED`): su
 * fulfillment se descompone en componentes y todavia no pasa por Picking. Se bloquea antes de la
 * confirmacion para que el usuario no llegue a un error del servidor.
 */
export const KIT_DEFERRED_MESSAGE =
  "Los kits solo se pueden vender con entrega inmediata. Quita el kit del ticket o cambia la modalidad a entrega inmediata.";

/** `true` si la combinacion (modalidad, ticket) incluye un kit en una entrega diferida. */
export function isKitDeferredSale(deliveryMethod: DeliveryMethod, hasKitItems: boolean): boolean {
  return hasKitItems && deliveryMethod !== DeliveryMethod.immediate;
}
