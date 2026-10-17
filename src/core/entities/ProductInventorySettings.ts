import type { ISODateString } from "@/core/types/common.types";

export interface ProductInventorySettings {
  id: string;
  tenantId: string;
  productId: string;
  branchId: string;
  minStock: number;
  reorderPoint?: number;
  defaultLocationId?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
