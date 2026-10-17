import type { ISODateString } from "@/core/types/common.types";

export interface CustomerSegment {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  active: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
