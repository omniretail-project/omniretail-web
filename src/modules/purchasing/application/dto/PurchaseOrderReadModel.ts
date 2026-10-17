import type { PurchaseOrderStatus } from "@/core/enums";

export type PurchaseOrderStatusFilter = PurchaseOrderStatus | "all";

export interface PurchaseOrderLineReadModel {
  id: string;
  productName: string;
  sku: string;
  supplierSku?: string;
  quantity: number;
  unitLabel: string;
  purchaseToBaseFactor?: number;
  unitCost: number;
  suggestedUnitCost?: number;
  subtotal: number;
  receivedQuantity?: number;
  expectedDate?: string;
  registeredCost?: number;
}

export interface PurchaseOrderReceptionReadModel {
  received?: number;
  ordered?: number;
  percentage: number;
  label: string;
  tone: "neutral" | "warning" | "success" | "info";
}

export interface PurchaseOrderAction {
  id:
    | "edit-draft"
    | "send-approval"
    | "approve"
    | "cancel"
    | "continue-receiving"
    | "download-purchase-order-pdf"
    | "download-receiving-pdf";
  label: string;
  enabled: boolean;
  statusTarget?: PurchaseOrderStatus;
  unavailableReason?: string;
}

export interface PurchaseOrderRowReadModel {
  id: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  number: string;
  supplierId: string;
  supplierName: string;
  supplierContactLabel: string;
  status: PurchaseOrderStatus;
  expectedDate?: string;
  createdAt: string;
  total: number;
  productCount: number;
  lines: PurchaseOrderLineReadModel[];
  reception: PurchaseOrderReceptionReadModel;
  actions: PurchaseOrderAction[];
  searchText: string;
}

export interface ReorderSuggestionReadModel {
  id: string;
  productId: string;
  branchId: string;
  productName: string;
  sku: string;
  currentStock: number;
  reservedStock?: number;
  availableStock?: number;
  minStock: number;
  suggestedQuantity: number;
  shortage: number;
  preferredSupplierId?: string;
  preferredSupplierName: string;
  associatedSupplierCount: number;
}

export interface PurchaseOrdersReadModel {
  orders: PurchaseOrderRowReadModel[];
  suppliers: Array<{ id: string; name: string }>;
  statuses: PurchaseOrderStatus[];
  suggestions: ReorderSuggestionReadModel[];
  suggestionsNotice?: string;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
