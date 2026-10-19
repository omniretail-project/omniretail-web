import type { CatalogImageSource, ProductSalesPriceTier } from "@/core/entities";

export interface StorefrontCategoryDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  imageSource?: CatalogImageSource;
}

export interface StorefrontDiscoveryProductDto {
  id: string;
  sku: string;
  name: string;
  description?: string;
  brand?: string;
  salePrice: number;
  basePrice?: number;
  effectivePrice?: number;
  discountAmount?: number;
  promotionId?: string;
  salesPriceTiers: Array<Pick<ProductSalesPriceTier, "minQuantity" | "unitPrice" | "active">>;
  categoryId: string;
  categoryName?: string;
  imageSource?: CatalogImageSource;
  imageAlt?: string;
  /** null means the product does not consume tracked stock (for example a service). */
  availableQuantity: number | null;
  saleUnitId: string;
  saleUnitName: string;
  /** Solo viene en el detalle público del producto. */
  attributes?: Array<{ name: string; value: string }>;
  /** Solo viene en el detalle público del producto. */
  availability?: Array<{
    branchId: string;
    branchName: string;
    address?: string;
    available: boolean;
  }>;
}

export interface StorefrontDiscoveryDto {
  categories: StorefrontCategoryDto[];
  products: StorefrontDiscoveryProductDto[];
}
