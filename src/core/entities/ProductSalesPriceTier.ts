import type { ISODateString } from "@/core/types/common.types";

export interface ProductSalesPriceTier {
  id: string;
  tenantId: string;
  productId: string;
  minQuantity: number;
  unitPrice: number;
  active: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
