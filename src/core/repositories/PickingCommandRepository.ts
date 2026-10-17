import type {
  PickingIncidentReadModel,
  PickingReadLine,
  PickingReleaseReadModel,
} from "@/core/repositories/PickingReadRepository";
import type { OrderStatus, PickingIncidentType, PickingStatus } from "@/core/enums";
import type { PickingScope } from "@/core/repositories/PickingRepository";

export interface PickingTrackingSelectionCommand {
  locationId: string;
  lotId: string | null;
  quantity: number;
  serialNumbers: string[];
}

export interface UpdatePickingLineCommand {
  pickedQuantity: number;
  locationId: string | null;
  operationId: string;
  trackingSelections: PickingTrackingSelectionCommand[];
}

export interface PickingCommandActionResult {
  pickingOrderId: string;
  orderId: string | null;
  status: PickingStatus;
  assignedUserId: string | null;
  orderStatus: OrderStatus | null;
  updatedAt: string;
  idempotent: boolean;
  sourceType: "order" | "transfer";
  sourceId: string;
  sourceReference: string | null;
}

export interface CreatePickingIncidentCommand {
  pickingLineId?: string;
  type: PickingIncidentType;
  quantityAffected?: number;
  comment: string;
}

/** Commands derive tenant and actor from the authenticated backend session. */
export interface PickingCommandRepository {
  assign(scope: PickingScope, pickingOrderId: string): Promise<PickingCommandActionResult>;
  release(
    scope: PickingScope,
    pickingOrderId: string,
    reason: string,
  ): Promise<PickingReleaseReadModel>;
  updateItem(
    scope: PickingScope,
    pickingOrderId: string,
    pickingItemId: string,
    command: UpdatePickingLineCommand,
  ): Promise<PickingReadLine>;
  createIncident(
    scope: PickingScope,
    pickingOrderId: string,
    command: CreatePickingIncidentCommand,
  ): Promise<PickingIncidentReadModel>;
  resolveIncident(
    scope: PickingScope,
    pickingOrderId: string,
    incidentId: string,
  ): Promise<PickingIncidentReadModel>;
  complete(scope: PickingScope, pickingOrderId: string): Promise<PickingCommandActionResult>;
}
