import type { CatalogImageSource, ProductMedia } from "@/core/entities";

export const CATALOG_IMAGE_FALLBACK = "/images/products/placeholder-product.webp";

export function isSafeCatalogImageUrl(value: string): boolean {
  const source = value.trim();
  if (!source || source.startsWith("blob:") || source.startsWith("data:")) return false;
  if (source.startsWith("/")) {
    return !source.includes("..") && !source.includes("\\") && !source.startsWith("//");
  }
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getProductMediaSource(media: ProductMedia): CatalogImageSource | null {
  if (media.source?.kind === "mockAsset" && media.source.assetId.trim()) return media.source;
  if (media.source?.kind === "url" && isSafeCatalogImageUrl(media.source.src)) {
    return { kind: "url", src: media.source.src.trim() };
  }
  return isSafeCatalogImageUrl(media.url) ? { kind: "url", src: media.url.trim() } : null;
}

export function normalizeCatalogImageSource(
  source: CatalogImageSource | null | undefined,
): CatalogImageSource | null {
  if (source?.kind === "mockAsset" && source.assetId.trim()) {
    return { kind: "mockAsset", assetId: source.assetId.trim() };
  }
  if (source?.kind === "url" && isSafeCatalogImageUrl(source.src)) {
    return { kind: "url", src: source.src.trim() };
  }
  return null;
}

export function sortProductMediaForDisplay(media: ProductMedia[]): ProductMedia[] {
  return [...media]
    .filter((item) => item.type === "image" && getProductMediaSource(item))
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return left.sortOrder - right.sortOrder;
    });
}

export function selectPrimaryProductMedia(media: ProductMedia[]): ProductMedia | null {
  return sortProductMediaForDisplay(media)[0] ?? null;
}
