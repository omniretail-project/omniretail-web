export interface SaleTicketItemDto {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  baseUnitPrice: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
  availableQuantity: number | null;
  saleUnitId: string;
  saleUnitName: string;
  tracksStock: boolean;
  requiresUnsupportedTraceability: boolean;
  /** Producto tipo kit: el backend no admite su fulfillment diferido (retiro o domicilio). */
  isKit?: boolean;
}

export interface SaleTicketDto {
  items: SaleTicketItemDto[];
  subtotal: number;
  discountTotal: number;
  total: number;
  hasUnsupportedTraceability: boolean;
}
