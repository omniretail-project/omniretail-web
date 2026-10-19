import type { ProductType } from "@/core/enums";
import type { ProductSalesPriceTier, Promotion } from "@/core/entities";

export interface PosProductDto {
  productId: string;
  sku: string;
  barcode?: string;
  name: string;
  productType: ProductType;
  basePrice: number;
  effectivePrice: number;
  discount: number;
  salesPriceTiers: Array<Pick<ProductSalesPriceTier, "minQuantity" | "unitPrice" | "active">>;
  promotion?: Pick<Promotion, "id" | "type" | "value">;
  availableQuantity: number | null;
  baseUnitId: string;
  saleUnitId: string;
  saleUnitName: string;
  /** Cantidad de unidades base representadas por una unidad de venta. */
  saleUnitToBaseFactor: number;
  tracksStock: boolean;
  requiresLot: boolean;
  requiresSerial: boolean;
  requiresExpiration: boolean;
  /** El flujo API puede preparar una seleccion fisica antes de agregar la linea al ticket. */
  requiresTraceabilitySelection: boolean;
  requiresUnsupportedTraceability: boolean;
  isAvailableForSale: boolean;
}
