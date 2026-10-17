import type { ISODateString } from "@/core/types/common.types";

export interface Address {
  id: string;
  tenantId: string;
  customerId: string;
  label: string;
  recipientName: string;
  line1: string;
  line2?: string;
  city: string;
  stateOrDepartment?: string;
  postalCode?: string;
  country: string;
  references?: string;
  isDefault: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
