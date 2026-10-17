import type { Customer } from "@/core/entities";

export interface CustomerProductPurchase {
  productName: string;
  totalQuantity: number;
}

export type CustomerDto = Omit<Customer, "tenantId"> & {
  purchaseCount: number;
  topProducts: CustomerProductPurchase[];
};
