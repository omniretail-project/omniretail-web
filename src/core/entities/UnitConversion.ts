import type { ISODateString } from "@/core/types/common.types";

export interface UnitConversion {
  id: string;
  tenantId: string;
  productId?: string;
  fromUnitId: string;
  toUnitId: string;
  factor: number;
  createdAt: ISODateString;
}
