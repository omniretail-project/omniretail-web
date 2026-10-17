import type { ProductMedia } from "@/core/entities";

export interface ProductMediaUploadInput {
  tenantId: string;
  file: Blob;
  alt?: string;
  sortOrder?: number;
  isPrimary?: boolean;
}

export interface ProductMediaRepository {
  getByProduct(productId: string, tenantId?: string): Promise<ProductMedia[]>;
  getPrimaryByProduct(productId: string, tenantId?: string): Promise<ProductMedia | null>;
  getByAssetId(tenantId: string, assetId: string): Promise<ProductMedia[]>;
  add(input: Omit<ProductMedia, "id">): Promise<ProductMedia>;
  uploadForProduct(productId: string, input: ProductMediaUploadInput): Promise<ProductMedia>;
  update(media: ProductMedia): Promise<ProductMedia>;
  removeFromProduct(productId: string, mediaId: string): Promise<void>;
  /** Compatibilidad mock legacy. Los flujos API deben usar removeFromProduct. */
  remove(id: string): Promise<void>;
  setPrimary(productId: string, mediaId: string): Promise<void>;
}
