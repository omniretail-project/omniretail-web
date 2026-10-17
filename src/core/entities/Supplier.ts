import type { SupplierStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  /** Read-only rollup: maximum lead time among this supplier's active product relations. */
  leadTimeDays?: number;
  status: SupplierStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
