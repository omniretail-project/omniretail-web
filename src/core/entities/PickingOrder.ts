import type { PickingPriority, PickingStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface PickingOrder {
  id: string;
  tenantId: string;
  orderId?: string;
  /** Transfer identity lives only in sourceType/sourceId; Order keeps orderId. */
  sourceType?: "order" | "transfer";
  sourceId?: string;
  branchId: string;
  assignedUserId?: string;
  status: PickingStatus;
  priority: PickingPriority;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
