import type { UnitCategory, UnitStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface Unit {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  symbol: string;
  category: UnitCategory;
  allowsDecimals: boolean;
  status: UnitStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
