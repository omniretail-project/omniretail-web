"use client";

import Image, { type ImageProps } from "next/image";
import type { CatalogImageSource } from "@/core/entities";
import { useCatalogImageUrl } from "@/infrastructure/media/useCatalogImageUrl";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

/**
 * Solo las imagenes servidas por este frontend pasan por el optimizador (redimensiona por
 * dispositivo y convierte a WebP/AVIF). URLs externas y blobs del modo mock se sirven tal cual.
 */
const OPTIMIZABLE_PREFIXES = ["/api/media/", "/images/"];

function isOptimizable(src: string): boolean {
  return OPTIMIZABLE_PREFIXES.some((prefix) => src.startsWith(prefix));
}

export function StorefrontCatalogImage({
  source,
  alt,
  ...imageProps
}: Omit<ImageProps, "alt" | "src" | "unoptimized"> & {
  source?: CatalogImageSource;
  alt: string;
  /** Ancho y alto de referencia en px CSS; el layout real lo sigue definiendo `className`. */
  width: number;
  height: number;
}) {
  const { tenantId } = usePublicTenant();
  const src = useCatalogImageUrl(tenantId, source);
  return <Image {...imageProps} alt={alt} src={src} unoptimized={!isOptimizable(src)} />;
}
