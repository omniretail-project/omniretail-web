import type { ISODateString } from "@/core/types/common.types";

export interface ProductPriceHistory {
  id: string;
  tenantId: string;
  productId: string;
  previousPrice: number;
  newPrice: number;
  actorUserId?: string;
  reason?: string;
  changedAt: ISODateString;
}
