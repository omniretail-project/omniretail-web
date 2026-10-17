import type { ISODateString } from "@/core/types/common.types";
import type { CatalogImageSource } from "@/core/entities/CatalogImage";

export type ProductMediaType = "image" | "video";

export interface ProductMedia {
  id: string;
  tenantId: string;
  productId: string;
  type: ProductMediaType;
  /** URL/path persistida. Los assets locales del modo mock usan `source` y una URL vacía. */
  url: string;
  source?: CatalogImageSource;
  alt?: string;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: ISODateString;
  updatedAt?: ISODateString;
}
