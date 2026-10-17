import type { SerialStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface SerialNumber {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  locationId?: string;
  lotId?: string;
  serialNumber: string;
  status: SerialStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
