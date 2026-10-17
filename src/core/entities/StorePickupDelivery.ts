import type { ISODateString } from "@/core/types/common.types";

/** Canonical evidence of a store-pickup Order handed to its recipient. */
export interface StorePickupDelivery {
  id: string;
  tenantId: string;
  branchId: string;
  orderId: string;
  confirmedByUserId: string;
  confirmationOperationId: string;
  confirmationFingerprint: string;
  deliveredAt: ISODateString;
  createdAt: ISODateString;
}
