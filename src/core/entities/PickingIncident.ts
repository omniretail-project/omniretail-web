import type { PickingIncidentStatus, PickingIncidentType } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface PickingIncident {
  id: string;
  tenantId: string;
  branchId: string;
  pickingOrderId: string;
  pickingLineId?: string;
  type: PickingIncidentType;
  quantityAffected?: number;
  comment: string;
  status: PickingIncidentStatus;
  createdBy: string;
  createdAt: ISODateString;
  resolvedBy?: string;
  resolvedAt?: ISODateString;
}
