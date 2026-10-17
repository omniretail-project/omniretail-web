export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  supplierProductId?: string;
  productId: string;
  /** Historical labels captured by the backend when the order line is saved. */
  productNameSnapshot?: string;
  productSkuSnapshot?: string;
  supplierSkuSnapshot?: string;
  quantity: number;
  unitId: string;
  unitSymbolSnapshot?: string;
  /** Historical conversion captured when the purchase-order line is saved. */
  purchaseToBaseFactor: number;
  unitCost: number;
  suggestedUnitCost?: number;
  subtotal: number;
}
