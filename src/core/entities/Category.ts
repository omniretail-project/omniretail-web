import type { CategoryStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";
import type { CatalogImageSource } from "@/core/entities/CatalogImage";

export interface Category {
  id: string;
  tenantId: string;
  parentId?: string;
  name: string;
  slug: string;
  description?: string;
  image?: CatalogImageSource;
  status: CategoryStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
