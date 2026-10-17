import type {
  DeliveryMethod,
  PickingIncidentStatus,
  PickingIncidentType,
  PickingItemStatus,
  PickingPriority,
  PickingStatus,
} from "@/core/enums";
import type { PickingInventoryAvailability } from "@/core/repositories";
import type { StorePickupContactSnapshot } from "@/core/types/storePickupContact.types";

export interface PickingProgressDto {
  requiredQuantity: number;
  pickedQuantity: number;
  remainingQuantity: number;
  percentage: number;
}

export interface PickingQueueItemDto {
  pickingOrderId: string;
  orderId?: string;
  orderReference: string;
  customerName: string;
  storePickupContact: StorePickupContactSnapshot | null;
  deliveryMethod: DeliveryMethod | "transfer";
  sourceType?: "order" | "transfer";
  sourceId?: string;
  branchId: string;
  status: PickingStatus;
  priority: PickingPriority;
  assignedUserId: string | null;
  progress: PickingProgressDto;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PickingDetailLineDto {
  pickingLineId: string;
  orderItemId?: string;
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
  inventory: PickingInventoryAvailability;
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

export interface PickingIncidentDto {
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

export interface PickingReleaseDto {
  id: string;
  pickingOrderId: string;
  actorUserId: string;
  reason: string;
  releasedAt: string;
}

export interface PickingDetailDto {
  pickingOrderId: string;
  orderId?: string;
  orderReference: string;
  customerName: string;
  storePickupContact: StorePickupContactSnapshot | null;
  deliveryMethod: DeliveryMethod | "transfer";
  sourceType?: "order" | "transfer";
  sourceId?: string;
  branchId: string;
  status: PickingStatus;
  priority: PickingPriority;
  assignedUserId: string | null;
  progress: PickingProgressDto;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: PickingDetailLineDto[];
  incidents: PickingIncidentDto[];
  releases: PickingReleaseDto[];
}

export interface PickingActionResultDto {
  pickingOrderId: string;
  orderId?: string;
  status: PickingStatus;
  assignedUserId: string | null;
  updatedAt: string;
  idempotent: boolean;
}
