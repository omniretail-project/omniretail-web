import type { InventoryAdjustmentType } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface InventoryAdjustment {
  id: string;
  tenantId: string;
  number: string;
  branchId: string;
  productId: string;
  locationId?: string;
  type: InventoryAdjustmentType;
  reason: string;
  notes?: string;
  quantityBefore: number;
  quantityAfter: number;
  delta: number;
  performedByUserId?: string;
  createdAt: ISODateString;
}
