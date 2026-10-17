import type {
  ReceiptIncidentApiStatus,
  ReceiptIncidentEvidence,
  ReceiptIncidentTypeCode,
} from "@/core/entities";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";
import type { NumericInputValue } from "@/shared/utils/numberInput";

export type ReceivingDocumentDetailType = "purchase_order" | "transfer";

export const RECEIPT_INCIDENT_TYPE_LABELS: Record<ReceiptIncidentTypeCode, string> = {
  missing: "Faltante",
  damaged: "Dañado",
  wrong_item: "Producto incorrecto",
  expired: "Vencido",
  other: "Otro",
};

export interface ReceivingDocumentDetail {
  document: ReceivingDocumentHeader;
  lines: ReceivingDocumentLine[];
  locations: ReceivingLocationOption[];
  incidentTypes: ReceivingIncidentTypeOption[];
  incidents: ReceivingDocumentIncident[];
  previousReceipts: ReceivingPreviousReceipt[];
  capabilities: ReceivingCapabilityFlags;
  dataSource: "mock" | "api";
  canConfirm: boolean;
  canManageIncidents: boolean;
  readOnly: boolean;
  /** Bloquea PUT sin impedir resolver incidencias ni confirmar el draft canónico. */
  draftEditingLocked?: boolean;
  incidentListIncomplete?: boolean;
  /** La primera página no contiene todo el historial confirmado del backend. */
  receiptHistoryIncomplete?: boolean;
  /** Reglas resueltas por el servicio para una recepción de traslado en modo API. */
  transferReception?: TransferReceptionReadModel;
}

export interface TransferReceptionReadModel {
  /** El backend actual admite una sola ubicación de destino por confirmación. */
  requiresSingleDestinationLocation: true;
  /** Estado y permisos permiten preparar una seleccion, aunque todavia no sea confirmable. */
  canReceiveTransfer: boolean;
  /** La recepción puede enviarse con las cantidades ingresadas por el usuario. */
  canConfirmTransfer: boolean;
  /** Ubicación operativa resuelta desde ProductInventorySettings.defaultLocationId. */
  destinationLocationId?: string;
  destinationLocationName?: string;
  /** Líneas que no pueden recibirse con el contrato actual. */
  blockedLineIds: string[];
  /** Líneas que requieren selecciones físicas que Backend aún no devuelve al Frontend. */
  traceabilityBlockedLineIds: string[];
  /** Lineas cuyo producto no pudo resolverse desde el catalogo autoritativo. */
  unavailableProductLineIds: string[];
  /** Explicación visible y estable para la interfaz cuando la operación queda bloqueada. */
  blockingReason?: string;
}

export interface ReceivingDocumentHeader {
  id: string;
  type: ReceivingDocumentDetailType;
  number: string;
  typeLabel: string;
  originLabel: string;
  originName: string;
  branchId: string;
  branchName: string;
  tenantId: string;
  expectedDate?: string;
  statusLabel: string;
  receiptId?: string;
  receiptNumber?: string;
}

export interface ReceivingDocumentLine {
  id: string;
  sourceLineId: string;
  receiptLineId?: string;
  /** UUID de GoodsReceiptItem; nunca confundir con sourceLineId (PurchaseOrderItem). */
  goodsReceiptItemId?: string;
  productId: string;
  productName: string;
  sku: string;
  unitId: string;
  unitName: string;
  unitAllowsDecimals: boolean;
  baseUnitId: string;
  baseUnitName: string;
  baseUnitAllowsDecimals: boolean;
  orderedQuantity: number;
  acceptedPreviously: number;
  receivedNow: NumericInputValue;
  pendingQuantity: number;
  locationId: string;
  defaultLocationId?: string;
  /**
   * Ubicacion guardada en el borrador que ya no coincide con la operativa asignada. Se corrige al
   * guardar (con cantidades, lotes, series e incidencias intactos); la UI lo avisa en vez de ocultarlo.
   */
  staleSavedLocationId?: string;
  tracking: ProductTrackingConfig;
  lotNumber: string;
  expirationDate: string;
  serialNumbersText: string;
  /** Fuente de verdad del editor 7A2 para Goods Receipt API. */
  trackingDetails: ReceivingTrackingDetail[];
  notes: string;
  purchaseToBaseFactor: number;
  /** Tiene alguna incidencia (abierta o resuelta): el backend conserva su GoodsReceiptItem. */
  incidentProtected?: boolean;
}

export interface ReceivingTrackingDetail {
  id: string;
  baseQuantity: NumericInputValue;
  lotNumber: string;
  expirationDate: string;
  serialNumbersText: string;
}

export interface ReceivingLocationOption {
  id: string;
  name: string;
  code: string;
}

export interface ReceivingIncidentTypeOption {
  id: string;
  name: string;
}

export interface ReceivingDocumentIncident {
  id: string;
  receiptId: string;
  receiptLineId?: string;
  goodsReceiptItemId?: string;
  productId?: string;
  productName: string;
  sku: string;
  incidentTypeId: string;
  incidentType?: ReceiptIncidentTypeCode;
  status?: ReceiptIncidentApiStatus;
  incidentTypeName: string;
  quantityAffected?: number;
  description: string;
  evidence: ReceiptIncidentEvidence[];
  createdAt: string;
  createdByUserId: string;
  createdByName: string;
  receiptNumber: string;
  editable: boolean;
}

export interface ReceivingPreviousReceipt {
  id: string;
  sequenceNumber: number;
  orderNumber: string;
  number: string;
  receivedAt: string;
  responsibleName: string;
  statusLabel: string;
  acceptedQuantity: number;
  incidentQuantity: number;
  pendingAfter: number;
  lines: ReceivingPreviousReceiptLine[];
  incidents: ReceivingDocumentIncident[];
}

export interface ReceivingPreviousReceiptLine {
  id: string;
  productName: string;
  sku: string;
  acceptedQuantity: number;
  orderedQuantity: number;
  incidentQuantity: number;
  pendingAfter: number;
  unitName: string;
  locationName: string;
  lotNumber: string;
  expirationDate: string;
  serialNumbers: string[];
}

export interface ReceivingCapabilityFlags {
  supportsInventory: boolean;
  supportsLots: boolean;
  supportsExpiration: boolean;
  supportsSerials: boolean;
  supportsMultipleLocations: boolean;
  supportsUnitsAndPackaging: boolean;
}

export interface SaveReceivingProgressInput {
  documentType: ReceivingDocumentDetailType;
  documentId: string;
  lines: ReceivingDocumentLine[];
  incidents: ReceivingDocumentIncident[];
}

export interface ConfirmReceivingInput extends SaveReceivingProgressInput {
  confirmationId: string;
  /** El hook real siempre lo envía; opcional para comandos legacy/mock ya existentes. */
  hasUnsavedChanges?: boolean;
  /** Payload efectivo persistido antes del POST de un traslado API. */
  transferOperation?: {
    destinationLocationId: string;
    idempotentReplay: boolean;
  };
}

export interface CreateReceivingIncidentInput {
  documentId: string;
  receiptId: string;
  incidentType: ReceiptIncidentTypeCode;
  goodsReceiptItemId?: string;
  quantityAffected?: number;
  notes: string;
}
