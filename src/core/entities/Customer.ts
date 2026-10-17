import type { CustomerStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface Customer {
  id: string;
  tenantId: string;
  userId?: string;
  code: string;
  name: string;
  email: string;
  phone?: string;
  segmentId?: string;
  status: CustomerStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
