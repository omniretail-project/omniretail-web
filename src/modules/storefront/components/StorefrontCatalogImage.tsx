"use client";

/* eslint-disable @next/next/no-img-element */

import type { ImgHTMLAttributes } from "react";
import type { CatalogImageSource } from "@/core/entities";
import { useCatalogImageUrl } from "@/infrastructure/media/useCatalogImageUrl";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

export function StorefrontCatalogImage({
  source,
  alt,
  ...imageProps
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "src"> & {
  source?: CatalogImageSource;
  alt: string;
}) {
  const { tenantId } = usePublicTenant();
  const src = useCatalogImageUrl(tenantId, source);
  return <img {...imageProps} alt={alt} src={src} />;
}
