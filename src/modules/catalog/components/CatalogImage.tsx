"use client";

/* eslint-disable @next/next/no-img-element */

import type { ImgHTMLAttributes } from "react";
import type { CatalogImageSource } from "@/core/entities";
import { useBlobPreviewUrl, useCatalogImageUrl } from "@/infrastructure/media/useCatalogImageUrl";

export function CatalogImage({
  alt,
  source,
  tenantId,
  previewBlob,
  ...imageProps
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "src"> & {
  alt: string;
  source?: CatalogImageSource;
  tenantId?: string;
  previewBlob?: Blob;
}) {
  const previewUrl = useBlobPreviewUrl(previewBlob);
  const resolvedUrl = useCatalogImageUrl(tenantId, source);
  return <img {...imageProps} alt={alt} src={previewUrl ?? resolvedUrl} />;
}
