import type { BranchStatus, BranchType } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface Branch {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: BranchType;
  address?: string;
  phone?: string;
  email?: string;
  status: BranchStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
