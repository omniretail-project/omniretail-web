import type { InventoryMovementType } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface InventoryMovement {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  /** Present for movements whose physical stock was consumed or received by lot. */
  lotId?: string;
  serialNumberId?: string;
  type: InventoryMovementType;
  reason: string;
  quantity: number;
  quantityBefore?: number;
  quantityAfter?: number;
  fromLocationId?: string;
  toLocationId?: string;
  referenceType?: string;
  referenceId?: string;
  performedByUserId?: string;
  createdAt: ISODateString;
}
