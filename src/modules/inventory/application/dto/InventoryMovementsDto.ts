import type { InventoryMovementType } from "@/core/enums";
import type { InventoryMovementDisplayType } from "@/core/repositories";

export type MovementPeriodFilter = "7d" | "30d" | "90d" | "all";
export type MovementDisplayType =
  | "purchase_in"
  | "transfer_out"
  | "transfer_in"
  | "inventory_adjustment"
  | "shrinkage"
  | "manual_in"
  | "manual_out"
  | "sale"
  | "dispatch"
  | "return"
  | "void"
  | "store_pickup"
  | "in"
  | "out"
  | "adjustment"
  | "transfer";
export type MovementTypeFilter = MovementDisplayType | "all";

export const API_MOVEMENT_DISPLAY_TYPES: readonly InventoryMovementDisplayType[] = [
  "purchase_in",
  "sale",
  "return",
  "void",
  "dispatch",
  "in",
  "out",
  "transfer",
];

export interface InventoryTransferDetailDto {
  number: string;
  sourceBranchName: string;
  destinationBranchName: string;
  productName: string;
  requestedQuantity: number;
  dispatchedQuantity: number;
  receivedQuantity: number;
  directionLabel: string;
}

export interface InventoryAdjustmentDetailDto {
  number: string;
  operationLabel: string;
  notes?: string;
  quantityBefore: number;
  delta: number;
  quantityAfter: number;
}

export interface InventoryMovementRow {
  id: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  productId: string;
  productName: string;
  sku: string;
  type: InventoryMovementType;
  displayType: MovementDisplayType;
  typeLabel: string;
  typeTone: "success" | "danger" | "warning" | "info";
  quantity: number;
  signedQuantity: number;
  quantityBefore?: number;
  quantityAfter?: number;
  unitLabel: string;
  fromLocationName?: string;
  toLocationName?: string;
  locationLabel: string;
  referenceType?: string;
  referenceId?: string;
  referenceLabel: string;
  performedByUserId?: string;
  userLabel: string;
  reason: string;
  createdAt: string;
  transferDetail?: InventoryTransferDetailDto;
  adjustmentDetail?: InventoryAdjustmentDetailDto;
}

export interface InventoryMovementsData {
  rows: InventoryMovementRow[];
  branches: Array<{ id: string; name: string }>;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  summary: InventoryMovementKpis;
}

export interface InventoryMovementKpis {
  incoming: number;
  outgoing: number;
  net: number;
}
