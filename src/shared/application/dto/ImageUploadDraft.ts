import type { CatalogImageAsset } from "@/core/entities";

export interface ImageUploadDraft {
  blob: Blob;
  mimeType: CatalogImageAsset["mimeType"];
  byteSize: number;
  width: number;
  height: number;
}
