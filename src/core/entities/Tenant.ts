import type { CurrencyCode, ISODateString } from "@/core/types/common.types";
import type { TenantStatus } from "@/core/enums";

export interface Tenant {
  id: string;
  name: string;
  legalName?: string;
  slug: string;
  status: TenantStatus;
  defaultCurrency: CurrencyCode;
  timezone: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
