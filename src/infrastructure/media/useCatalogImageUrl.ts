"use client";

import { useEffect, useState } from "react";
import type { CatalogImageSource } from "@/core/entities";
import { CATALOG_IMAGE_FALLBACK, isSafeCatalogImageUrl } from "@/core/media/catalogImage";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export function useCatalogImageUrl(
  tenantId: string | null | undefined,
  source: CatalogImageSource | null | undefined,
  fallback = CATALOG_IMAGE_FALLBACK,
): string {
  const repositories = useRepositories();
  const [assetUrl, setAssetUrl] = useState<{ key: string; url: string } | null>(null);
  const sourceKind = source?.kind;
  const sourceValue = source?.kind === "url" ? source.src : source?.assetId;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (sourceKind !== "mockAsset" || !sourceValue || !tenantId) return;
    const key = `${tenantId}:${sourceValue}`;
    void repositories.catalogImageAssets
      .get(tenantId, sourceValue)
      .then((asset) => {
        if (!active || !asset) return;
        objectUrl = URL.createObjectURL(asset.blob);
        setAssetUrl({ key, url: objectUrl });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fallback, repositories, sourceKind, sourceValue, tenantId]);

  if (sourceKind === "url") {
    return sourceValue && isSafeCatalogImageUrl(sourceValue) ? sourceValue : fallback;
  }
  const key =
    sourceKind === "mockAsset" && tenantId && sourceValue ? `${tenantId}:${sourceValue}` : null;
  return key && assetUrl?.key === key ? assetUrl.url : fallback;
}

export function useBlobPreviewUrl(blob: Blob | undefined): string | null {
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (!blob) return;
    const nextUrl = URL.createObjectURL(blob);
    queueMicrotask(() => {
      if (active) setPreview({ blob, url: nextUrl });
    });
    return () => {
      active = false;
      URL.revokeObjectURL(nextUrl);
    };
  }, [blob]);
  return blob && preview?.blob === blob ? preview.url : null;
}
