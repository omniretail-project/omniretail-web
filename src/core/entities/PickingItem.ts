import type { PickingItemStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface PickingItem {
  id: string;
  pickingOrderId: string;
  orderItemId: string;
  productId: string;
  requestedQuantity: number;
  pickedQuantity: number;
  locationId?: string;
  lotId?: string;
  serialNumbers?: string[];
  /** Physical picks retained until final fulfillment; no stock is consumed here. */
  pickedAllocations?: Array<{
    balanceId: string;
    locationId?: string;
    lotId?: string;
    quantity: number;
    serialNumbers?: string[];
  }>;
  status: PickingItemStatus;
}

export interface PickingItemUpdateOperation {
  id: string;
  tenantId: string;
  branchId: string;
  pickingOrderId: string;
  pickingItemId: string;
  operationId: string;
  fingerprint: string;
  resultItem: PickingItem;
  createdAt: ISODateString;
}
