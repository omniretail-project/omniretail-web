import type { PosApiTrackingSelection } from "@/core/repositories";

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
  /** Seleccion fisica canonicalizada que debe conservarse intacta durante un reintento. */
  trackingSelections?: PosApiTrackingSelection[];
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
