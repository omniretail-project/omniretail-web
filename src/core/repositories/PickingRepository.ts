import type {
  Order,
  PickingAssignmentRelease,
  PickingIncident,
  PickingItem,
  PickingOrder,
  Packing,
  InventoryTransfer,
} from "@/core/entities";
import type { PickingIncidentType, PickingItemStatus, PickingPriority } from "@/core/enums";

export interface PickingScope {
  tenantId: string;
  branchId: string;
}

export interface CreatePickingOrderInput extends PickingScope {
  orderId: string;
  priority: PickingPriority;
}

type PickingItemMetadataUpdate = Partial<
  Pick<PickingItem, "locationId" | "lotId" | "serialNumbers">
> & { status?: PickingItemStatus };

export type UpdatePickingItemInput = PickingScope &
  PickingItemMetadataUpdate & {
    pickingOrderId: string;
    pickingItemId: string;
    performedByUserId: string;
  } & (
    | {
        pickedQuantity: number;
        operationId: string;
      }
    | {
        pickedQuantity?: undefined;
        operationId?: never;
      }
  );

export interface AssignPickingOrderInput extends PickingScope {
  pickingOrderId: string;
  actorUserId: string;
}

export interface AssignPickingOrderResult {
  pickingOrder: PickingOrder;
  idempotent: boolean;
}

export interface ReleasePickingOrderInput extends AssignPickingOrderInput {
  reason: string;
}

export interface ReleasePickingOrderResult {
  pickingOrder: PickingOrder;
  release: PickingAssignmentRelease;
}

export interface RegisterPickingIncidentInput extends PickingScope {
  pickingOrderId: string;
  pickingLineId?: string;
  type: PickingIncidentType;
  quantityAffected?: number;
  comment: string;
  createdBy: string;
}

export interface ResolvePickingIncidentInput extends PickingScope {
  pickingOrderId: string;
  incidentId: string;
  resolvedBy: string;
}

export type CompletePickingOrderInput = AssignPickingOrderInput & { sourceType?: "order" };
export type CompleteTransferPickingOrderInput = AssignPickingOrderInput & { sourceType: "transfer" };

export interface CompletePickingOrderResult {
  pickingOrder: PickingOrder;
  order: Order;
  packing: Packing;
  idempotent: boolean;
}

export interface CompleteTransferPickingOrderResult {
  pickingOrder: PickingOrder;
  transfer: InventoryTransfer;
  packing: Packing;
  idempotent: boolean;
}

/** All reads are tenant + branch scoped; actor IDs are resolved by an application boundary. */
export interface PickingRepository {
  getQueue(scope: PickingScope): Promise<PickingOrder[]>;
  getById(scope: PickingScope, pickingOrderId: string): Promise<PickingOrder | null>;
  getByOrder(scope: PickingScope, orderId: string): Promise<PickingOrder | null>;
  getBySource(scope: PickingScope, sourceType: "order" | "transfer", sourceId: string): Promise<PickingOrder | null>;
  getItems(scope: PickingScope, pickingOrderId: string): Promise<PickingItem[]>;
  create(input: CreatePickingOrderInput): Promise<PickingOrder>;
  assign(input: AssignPickingOrderInput): Promise<AssignPickingOrderResult>;
  release(input: ReleasePickingOrderInput): Promise<ReleasePickingOrderResult>;
  getReleaseHistory(
    scope: PickingScope,
    pickingOrderId: string,
  ): Promise<PickingAssignmentRelease[]>;
  updateItem(input: UpdatePickingItemInput): Promise<PickingItem>;
  registerIncident(input: RegisterPickingIncidentInput): Promise<PickingIncident>;
  getIncidents(scope: PickingScope, pickingOrderId: string): Promise<PickingIncident[]>;
  resolveIncident(input: ResolvePickingIncidentInput): Promise<PickingIncident>;
  complete(input: CompletePickingOrderInput): Promise<CompletePickingOrderResult>;
  complete(input: CompleteTransferPickingOrderInput): Promise<CompleteTransferPickingOrderResult>;
}
