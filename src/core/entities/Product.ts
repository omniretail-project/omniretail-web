import type { ProductStatus, ProductType } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";

export interface ProductChannels {
  ecommerce: boolean;
  pos: boolean;
  mobileApp: boolean;
}

export interface Product {
  id: string;
  tenantId: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  brand?: string;
  productType: ProductType;
  categoryId: string;
  /** Smallest indivisible unit used by stock, movements, reservations, lots and serials. */
  baseUnitId: string;
  /** Preferred input/display presentation. It never changes the stored stock unit. */
  inventoryUnitId?: string;
  saleUnitId?: string;
  salePrice: number;
  status: ProductStatus;
  tracking: ProductTrackingConfig;
  channels: ProductChannels;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
