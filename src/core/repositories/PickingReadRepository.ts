import type {
  DeliveryMethod,
  PickingIncidentStatus,
  PickingIncidentType,
  PickingItemStatus,
  PickingPriority,
  PickingStatus,
} from "@/core/enums";
import type { PickingScope } from "@/core/repositories/PickingRepository";
import type { StorePickupContactSnapshot } from "@/core/types/storePickupContact.types";

export interface PickingReadProgress {
  requiredQuantity: number;
  pickedQuantity: number;
  remainingQuantity: number;
  percentage: number;
}

export interface PickingQueueReadModel {
  pickingOrderId: string;
  orderId: string | null;
  orderReference: string | null;
  customerName: string | null;
  storePickupContact: StorePickupContactSnapshot | null;
  deliveryMethod: DeliveryMethod | null;
  branchId: string;
  status: PickingStatus;
  priority: PickingPriority;
  assignedUserId: string | null;
  progress: PickingReadProgress;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceType: "order" | "transfer";
  sourceId: string;
  sourceReference: string;
}

export interface PickingReadInventoryLot {
  lotId: string;
  lotNumber: string;
  expirationDate: string | null;
  physicalQuantity: number;
  serialNumbers: Array<{ id: string; serialNumber: string }>;
}

export interface PickingReadInventoryLocation {
  balanceId: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  physicalQuantity: number;
  ownReservedQuantity: number;
  otherReservedQuantity: number;
  freeQuantity: number;
  usableQuantity: number;
  lots: PickingReadInventoryLot[];
  serialNumbers: Array<{ id: string; serialNumber: string; lotId: string | null }>;
}

export interface PickingReadInventoryAvailability {
  tenantId: string;
  branchId: string;
  pickingOrderId: string;
  orderId: string | null;
  productId: string;
  physicalQuantity: number;
  ownReservedQuantity: number;
  otherReservedQuantity: number;
  freeQuantity: number;
  usableQuantity: number;
  locations: PickingReadInventoryLocation[];
}

export interface PickingReadLine {
  pickingLineId: string;
  orderItemId: string | null;
  productId: string;
  sku: string;
  name: string;
  requiredQuantity: number;
  pickedQuantity: number;
  remainingQuantity: number;
  status: PickingItemStatus;
  location: { id: string; code: string; name: string } | null;
  lot: { id: string; number: string } | null;
  serialNumbers: string[];
  availableLocations: Array<{
    id: string | null;
    code: string | null;
    name: string | null;
    ownReservedQuantity: number;
    usableQuantity: number;
  }>;
  availableLots: Array<{
    id: string;
    number: string;
    expirationDate: string | null;
    physicalQuantity: number;
  }>;
  availableSerialNumbers: string[];
  tracking: { stock: boolean; lot: boolean; expiration: boolean; serial: boolean };
  inventory: PickingReadInventoryAvailability;
  sourceLineId: string;
  trackingSelections: Array<{
    locationId: string | null;
    lotId: string | null;
    lotNumber: string | null;
    expirationDate: string | null;
    quantity: number;
    serialNumbers: string[];
  }>;
}

export interface PickingIncidentReadModel {
  id: string;
  pickingOrderId: string;
  pickingLineId: string | null;
  type: PickingIncidentType;
  quantityAffected: number | null;
  comment: string;
  status: PickingIncidentStatus;
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface PickingReleaseReadModel {
  id: string;
  pickingOrderId: string;
  actorUserId: string;
  reason: string;
  releasedAt: string;
}

export interface PickingDetailReadModel extends PickingQueueReadModel {
  completedAt: string | null;
  lines: PickingReadLine[];
  incidents: PickingIncidentReadModel[];
  releases: PickingReleaseReadModel[];
}

/** Proyeccion agregada read-only; el tenant lo deriva el backend de la sesion. */
export interface PickingReadRepository {
  getQueue(scope: PickingScope): Promise<PickingQueueReadModel[]>;
  getDetail(scope: PickingScope, pickingOrderId: string): Promise<PickingDetailReadModel>;
}
