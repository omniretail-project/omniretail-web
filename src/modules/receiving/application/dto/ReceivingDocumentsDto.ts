export type ReceivingDocumentType = "purchase_order" | "transfer";
export type ReceivingStatus = "pending" | "in_process" | "partial" | "received";
export type ReceivingTab = "orders" | "incidents";

export interface ReceivingDocumentRow {
  id: string;
  documentId: string;
  documentNumber: string;
  documentType: ReceivingDocumentType;
  documentTypeLabel: string;
  supplierOrSource: string;
  expectedDate?: string;
  productCount: number;
  requestedQuantity: number;
  receivedQuantity: number;
  status: ReceivingStatus;
  statusLabel: string;
  lastUpdatedAt: string;
  searchText: string;
}

export interface IncidentTypeReadModel {
  id: string;
  name: string;
  code: string;
  active: boolean;
  usageCount: number;
  canDelete: boolean;
  canArchive: boolean;
}

export type ReceivingIncidentRow =
  import("@/modules/receiving/application/dto/IncidentListItemViewModel").IncidentListItemViewModel;

export interface ReceivingReadModel {
  documents: ReceivingDocumentRow[];
  incidents: ReceivingIncidentRow[];
  incidentTypes: IncidentTypeReadModel[];
  /** Al menos un receipt tiene más incidencias que la primera página cargada. */
  incidentListIncomplete?: boolean;
  pagination?: ReceivingPaginationState;
}

export type ReceivingPurchaseOrderStream =
  | "approved"
  | "sent"
  | "partially_received"
  | "received";

export interface ReceivingPaginationStreamState {
  currentPage: number;
  totalPages: number;
}

export interface ReceivingPaginationState {
  branchId: string;
  streams: Record<ReceivingPurchaseOrderStream, ReceivingPaginationStreamState>;
  hasMore: boolean;
  /** El backend no ofrece un agregado de cantidades recibidas por PO. */
  receiptHistoryIncomplete: boolean;
}
