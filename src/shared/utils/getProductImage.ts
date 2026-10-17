import type { ProductMedia } from "@/core/entities";
import { getProductMediaSource, selectPrimaryProductMedia } from "@/core/media/catalogImage";

export const PRODUCT_IMAGE_PLACEHOLDER = "/images/products/placeholder-product.webp";

export function getProductImage(media: ProductMedia[]) {
  const primary = selectPrimaryProductMedia(media);
  const source = primary ? getProductMediaSource(primary) : null;
  return source?.kind === "url" ? source.src : PRODUCT_IMAGE_PLACEHOLDER;
}
