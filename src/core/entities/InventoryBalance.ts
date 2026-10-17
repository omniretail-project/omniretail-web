import type { ISODateString } from "@/core/types/common.types";

export interface InventoryBalance {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  locationId?: string;
  quantity: number;
  reservedQuantity: number;
  minStock?: number;
  reorderPoint?: number;
  updatedAt: ISODateString;
}
