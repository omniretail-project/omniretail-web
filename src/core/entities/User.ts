import type { UserStatus, UserType } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface User {
  id: string;
  tenantId: string;
  customerId?: string;
  employeeCode?: string;
  name: string;
  email: string;
  phone?: string;
  type: UserType;
  status: UserStatus;
  roleId?: string;
  branchId?: string;
  allowedBranchIds?: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
