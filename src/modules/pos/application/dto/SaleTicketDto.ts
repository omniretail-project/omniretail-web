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
  /** Unidad canonica del inventario usada por las selecciones fisicas. */
  baseUnitId?: string;
  /** Cantidad total preparada en unidades base para esta linea. */
  baseQuantity?: number;
  /** Factor confirmado al preparar la línea; evita asumir equivalencia con la unidad base. */
  saleUnitToBaseFactor?: number;
  saleUnitId: string;
  saleUnitName: string;
  tracksStock: boolean;
  /** Reglas de trazabilidad capturadas al preparar la línea; permiten revalidarla antes del POST. */
  requiresTraceabilitySelection?: boolean;
  requiresLot?: boolean;
  requiresSerial?: boolean;
  requiresExpiration?: boolean;
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
