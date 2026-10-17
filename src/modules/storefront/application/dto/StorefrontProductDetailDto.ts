import type { CatalogImageSource, Product } from "@/core/entities";

export interface StorefrontBranchAvailabilityDto {
  branchId: string;
  branchName: string;
  address?: string;
  available: boolean;
}

export interface StorefrontProductDetailDto {
  product: Product;
  categoryName?: string;
  media: Array<{ source: CatalogImageSource; alt?: string }>;
  attributes: Array<{ name: string; value: string }>;
  availability?: StorefrontBranchAvailabilityDto[];
  /**
   * Stock vendible del propio producto (modo api): `null` = no controla inventario. `undefined`
   * cuando la fuente no lo informa (modo mock), y la pagina usa el catalogo/`availability`.
   */
  availableQuantity?: number | null;
}
