import type { ISODateString } from "@/core/types/common.types";

export interface PriceTier {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  customerSegmentId?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
