export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  skuSnapshot: string;
  nameSnapshot: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
}
