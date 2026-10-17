import type { ISODateString } from "@/core/types/common.types";

export interface StockLot {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  locationId?: string;
  lotNumber: string;
  expirationDate?: ISODateString;
  quantity: number;
  createdAt: ISODateString;
}
