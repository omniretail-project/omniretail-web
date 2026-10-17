import type { DeliveryMethod, OrderStatus, PackingStatus } from "@/core/enums";
import type { PackingChecklist } from "@/core/entities";
import type { AddressSnapshot } from "@/core/types/address.types";
import type { StorePickupContactSnapshot } from "@/core/types/storePickupContact.types";

export interface PackingQueueItemDto {
  packingId: string;
  orderId?: string;
  orderReference: string;
  customerName: string;
  storePickupContact: StorePickupContactSnapshot | null;
  deliveryMethod: DeliveryMethod | "transfer";
  sourceType?: "order" | "transfer";
  sourceId?: string;
  status: PackingStatus;
  version: number;
  startedAt: string;
  updatedAt: string;
}

export interface PackingDetailDto extends PackingQueueItemDto {
  pickingOrderId: string;
  orderStatus: OrderStatus | null;
  deliveryAddress: AddressSnapshot | null;
  checklist: PackingChecklist;
  totalWeight: number | null;
  packageCount: number | null;
  labelGenerationId: string | null;
  labelCode: string | null;
  labelGeneratedAt: string | null;
  labelPrintedAt: string | null;
  finalizedAt: string | null;
  preparedContents: PackingPreparedContentDto[];
}

export interface PackingPreparedContentDto {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  serialNumbers: string[];
  trackingSelections: PackingTraceSelectionDto[];
}

export interface PackingTraceSelectionDto {
  locationId: string | null;
  lotId: string | null;
  lotNumber: string | null;
  expirationDate: string | null;
  quantity: number;
  serialNumbers: string[];
}

export interface SavePackingPreparationCommand {
  packingId: string;
  operationId: string;
  expectedVersion: number;
  checklist: PackingChecklist;
  totalWeight?: number;
  packageCount?: number;
}

export interface PackingVersionedCommand {
  packingId: string;
  operationId: string;
  expectedVersion: number;
}

export type GeneratePackingLabelCommand = PackingVersionedCommand;

export interface RegisterPackingLabelPrintCommand extends PackingVersionedCommand {
  labelGenerationId: string;
}

export type FinalizePackingCommand = PackingVersionedCommand;

export interface PackingActionResultDto {
  packing: PackingDetailDto;
  idempotent: boolean;
}

export interface FinalizePackingResultDto extends PackingActionResultDto {
  orderStatus: OrderStatus | null;
  transferStatus?: string;
}

export interface ConfirmStorePickupDeliveryCommand {
  packingId: string;
  operationId: string;
}

export interface ConfirmStorePickupDeliveryResultDto {
  packingId: string;
  orderId: string;
  orderStatus: OrderStatus;
  deliveredAt: string;
  idempotent: boolean;
}
