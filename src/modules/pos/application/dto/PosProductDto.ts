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
  saleUnitId: string;
  saleUnitName: string;
  tracksStock: boolean;
  requiresLot: boolean;
  requiresSerial: boolean;
  requiresUnsupportedTraceability: boolean;
  isAvailableForSale: boolean;
}
