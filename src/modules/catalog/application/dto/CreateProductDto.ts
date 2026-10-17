import type { ProductChannels } from "@/core/entities/Product";
import type { ProductStatus, ProductType } from "@/core/enums";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";

export interface CreateProductDto {
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  brand?: string;
  productType: ProductType;
  categoryId: string;
  baseUnitId: string;
  inventoryUnitId?: string;
  saleUnitId: string;
  salePrice: number;
  status: ProductStatus;
  tracking: ProductTrackingConfig;
  channels: ProductChannels;
  primaryImageUrl?: string;
}
