import type { CatalogImageAsset, StoredCatalogImageAsset } from "@/core/entities";

export interface CatalogImageAssetRepository {
  put(metadata: CatalogImageAsset, blob: Blob): Promise<void>;
  get(tenantId: string, assetId: string): Promise<StoredCatalogImageAsset | null>;
  remove(tenantId: string, assetId: string): Promise<void>;
}
