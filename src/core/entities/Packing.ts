import type { PackingOperationType, PackingStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface PackingChecklist {
  packageProtectionChecked: boolean;
  documentIncludedChecked: boolean;
  recipientVerifiedChecked: boolean;
}

export interface Packing {
  id: string;
  tenantId: string;
  branchId: string;
  orderId?: string;
  sourceType?: "order" | "transfer";
  sourceId?: string;
  pickingOrderId: string;
  status: PackingStatus;
  checklist: PackingChecklist;
  totalWeight?: number;
  packageCount?: number;
  labelGenerationId?: string;
  labelCode?: string;
  labelGeneratedAt?: ISODateString;
  labelPrintedAt?: ISODateString;
  startedByUserId: string;
  finalizedByUserId?: string;
  startedAt: ISODateString;
  finalizedAt?: ISODateString;
  version: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PackingOperation {
  id: string;
  tenantId: string;
  branchId: string;
  packingId: string;
  operationId: string;
  type: PackingOperationType;
  fingerprint: string;
  resultVersion: number;
  createdAt: ISODateString;
}
