import type { LocationStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export type StorageLocationType = "warehouse" | "aisle" | "shelf" | "level" | "counter" | "display";

export interface StorageLocation {
  id: string;
  tenantId: string;
  branchId: string;
  parentId?: string;
  code: string;
  name: string;
  type: StorageLocationType;
  description?: string;
  status: LocationStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
