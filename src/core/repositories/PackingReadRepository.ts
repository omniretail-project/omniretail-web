import type { DeliveryMethod, OrderStatus, PackingStatus } from "@/core/enums";
import type { PackingChecklist } from "@/core/entities";
import type { PackingScope } from "@/core/repositories/PackingRepository";
import type { AddressSnapshot } from "@/core/types/address.types";
import type { StorePickupContactSnapshot } from "@/core/types/storePickupContact.types";

export interface PackingTraceSelectionReadModel {
  locationId: string | null;
  lotId: string | null;
  lotNumber: string | null;
  expirationDate: string | null;
  quantity: number;
  serialNumbers: string[];
}

export interface PackingPreparedContentReadModel {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  serialNumbers: string[];
  trackingSelections: PackingTraceSelectionReadModel[];
}

export interface PackingQueueReadModel {
  packingId: string;
  orderId: string | null;
  orderReference: string | null;
  customerName: string | null;
  storePickupContact: StorePickupContactSnapshot | null;
  deliveryMethod: DeliveryMethod | null;
  sourceType: "order" | "transfer";
  sourceId: string;
  status: PackingStatus;
  version: number;
  startedAt: string;
  updatedAt: string;
  sourceReference: string;
}

export interface PackingDetailReadModel extends PackingQueueReadModel {
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
  preparedContents: PackingPreparedContentReadModel[];
}

/** Proyecciones agregadas del backend; el tenant se deriva de la sesion autenticada. */
export interface PackingReadRepository {
  getQueue(scope: PackingScope): Promise<PackingQueueReadModel[]>;
  getDetail(scope: PackingScope, packingId: string): Promise<PackingDetailReadModel>;
}
