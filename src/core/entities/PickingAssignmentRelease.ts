import type { ISODateString } from "@/core/types/common.types";

/** Append-only evidence that an actor relinquished a PickingOrder. */
export interface PickingAssignmentRelease {
  id: string;
  tenantId: string;
  branchId: string;
  pickingOrderId: string;
  actorUserId: string;
  reason: string;
  releasedAt: ISODateString;
}
