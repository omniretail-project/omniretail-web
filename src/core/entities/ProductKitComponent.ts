import type { ISODateString } from "@/core/types/common.types";

/** A physical product required to fulfill one commercial kit unit. */
export interface ProductKitComponent {
  id: string;
  tenantId: string;
  kitProductId: string;
  componentProductId: string;
  quantityPerKit: number;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}
