import type { PurchaseOrderStatus } from "@/core/enums";
import type { NumericInputValue } from "@/shared/utils/numberInput";

export interface PurchaseOrderEditorSupplier {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  notes?: string;
  paymentTermsLabel: string;
  currencyLabel: string;
  leadTimeLabel: string;
  leadTimeDays?: number;
}

export interface PurchaseOrderEditorLine {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  supplierSku: string;
  unitId: string;
  unitLabel: string;
  unitAllowsDecimals: boolean;
  purchaseToBaseFactor: number;
  quantity: NumericInputValue;
  baseCost: number;
  suggestedCost: number;
  agreedCost: NumericInputValue;
  subtotal: number;
  manualCost: boolean;
  minimumOrderQuantity: number;
  leadTimeDays?: number;
  tiers: Array<{ minQuantity: number; unitCost: number }>;
  stockQuantity?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  minStock?: number;
  reorderPoint?: number;
  shortage?: number;
  suggestedReorder?: number;
  availabilityLabel: string;
}

export interface PurchaseOrderAvailableProduct {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  supplierSku: string;
  categoryName: string;
  unitId: string;
  unitLabel: string;
  unitAllowsDecimals: boolean;
  purchaseToBaseFactor: number;
  configuredCost: number;
  minimumOrderQuantity: number;
  leadTimeDays?: number;
  tiers: Array<{ minQuantity: number; unitCost: number }>;
  stockQuantity?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  minStock?: number;
  reorderPoint?: number;
  shortage?: number;
  suggestedReorder?: number;
  availabilityLabel: string;
  searchText: string;
}

export interface PurchaseOrderEditorModel {
  id?: string;
  supplierId: string;
  baseDate: string;
  expectedDate: string;
  notes: string;
  lines: PurchaseOrderEditorLine[];
  status?: PurchaseOrderStatus;
}

export type PurchaseOrderPrefillSource = "inventory" | "inventory-alert" | "reorder-suggestion";

export interface PurchaseOrderPrefillContext {
  productId?: string;
  branchId?: string;
  supplierId?: string;
  suggestedQuantity?: number;
  suggestedQuantityInvalid?: boolean;
  source?: PurchaseOrderPrefillSource;
}

export interface PurchaseOrderPrefillResolution {
  productId: string;
  supplierId?: string;
  allowedSupplierIds: string[];
  quantity: number;
  notice: string;
  warning?: string;
}

export interface PurchaseOrderEditorData {
  loading: boolean;
  error: string | null;
  suppliers: PurchaseOrderEditorSupplier[];
  selectedSupplier?: PurchaseOrderEditorSupplier;
  availableProducts: PurchaseOrderAvailableProduct[];
  model: PurchaseOrderEditorModel;
  total: number;
}
