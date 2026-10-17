export const STOREFRONT_FREE_SHIPPING_THRESHOLD = 300;
export const STOREFRONT_STANDARD_SHIPPING_COST = 25;

export function calculateStorefrontShipping(subtotal: number): number {
  return subtotal >= STOREFRONT_FREE_SHIPPING_THRESHOLD
    ? 0
    : STOREFRONT_STANDARD_SHIPPING_COST;
}
