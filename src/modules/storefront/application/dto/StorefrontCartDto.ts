import type { Product } from "@/core/entities";

export interface StorefrontCartItemDto {
  productId: string;
  tenantId: string;
  sku: string;
  name: string;
  imageUrl?: string;
  imageAlt?: string;
  unitPrice: number;
  quantity: number;
}

export function createStorefrontCartItem(
  product: Pick<Product, "id" | "tenantId" | "sku" | "name" | "salePrice">,
  media?: Pick<StorefrontCartItemDto, "imageUrl" | "imageAlt">,
): StorefrontCartItemDto {
  return {
    productId: product.id,
    tenantId: product.tenantId,
    sku: product.sku,
    name: product.name,
    ...media,
    unitPrice: product.salePrice,
    quantity: 1,
  };
}
