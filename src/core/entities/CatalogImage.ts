import type { ISODateString } from "@/core/types/common.types";

export type CatalogImageSource =
  { kind: "url"; src: string } | { kind: "mockAsset"; assetId: string };

export interface CatalogImageAsset {
  id: string;
  tenantId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
  createdAt: ISODateString;
}

export interface StoredCatalogImageAsset {
  metadata: CatalogImageAsset;
  blob: Blob;
}
