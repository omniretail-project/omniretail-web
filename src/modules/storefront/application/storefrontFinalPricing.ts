import type { ProductSalesPriceTier } from "@/core/entities";
import type { StorefrontDiscoveryProductDto } from "@/modules/storefront/application/dto/StorefrontDiscoveryDto";

type PriceTier = Pick<ProductSalesPriceTier, "minQuantity" | "unitPrice" | "active">;

/**
 * Precios finales que calcula el backend (modo api): el de una unidad y el de cada escalón por
 * cantidad, con la promoción ya aplicada. Se usan tal cual con `resolveQuantityPrice` y sin volver
 * a aplicar promociones, así la tienda muestra exactamente lo que cobra el checkout.
 */
export interface StorefrontFinalPricing {
  basePrice: number;
  tiers: PriceTier[];
}

export function toFinalPricing(product: StorefrontDiscoveryProductDto): StorefrontFinalPricing {
  return {
    basePrice: product.effectivePrice ?? product.salePrice,
    tiers: product.finalPriceTiers ?? [],
  };
}
