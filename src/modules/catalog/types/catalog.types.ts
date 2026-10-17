import type {
  BusinessCapabilitiesConfig,
  CatalogImageSource,
  Category,
  InventoryBalance,
  Product,
  Promotion,
  SupplierProduct,
  Unit,
} from "@/core/entities";
import type { InventoryStockBatchItem, OperationalSupplier } from "@/core/repositories";
import type { ProductStatus, ProductType } from "@/core/enums";
import type { ProductChannels } from "@/core/entities/Product";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";

export interface ProductListPromotion {
  id: string;
  label: string;
  effectivePrice: number;
}

export type ProductPromotionFilter = "all" | "with" | "without";
export type ProductChannelKey = keyof ProductChannels;

export interface ProductFiltersState {
  search: string;
  status: "all" | ProductStatus;
  productType: "all" | ProductType;
  categoryId: "all" | string;
  channels: ProductChannelKey[];
  promotion: ProductPromotionFilter;
}

export interface ProductListItem {
  id: string;
  tenantId: string;
  imageSource?: CatalogImageSource;
  sku: string;
  barcode?: string;
  name: string;
  brand?: string;
  categoryName: string;
  categoryId: string;
  baseUnitName: string;
  baseUnitId: string;
  productType: ProductType;
  salePrice: number;
  channels: ProductChannels;
  hasActivePromotion: boolean;
  activePromotion?: ProductListPromotion;
  status: ProductStatus;
  tracking: ProductTrackingConfig;
  /** Available stock for the active operational branch; only populated for tracked physical products. */
  availableQuantity?: number;
}

export interface ProductDetailViewModel {
  product: Product;
  imageSource?: CatalogImageSource;
  category: Category | null;
  unit: Unit | null;
}

export interface ProductFormOptions {
  categories: Category[];
  units: Unit[];
  businessCapabilities: BusinessCapabilitiesConfig;
}

export interface ProductInventorySummaryItem {
  balance: InventoryBalance;
  branchName: string;
  locationName?: string;
  stockStatus: "Sin stock" | "Bajo" | "Disponible";
}

export interface ProductInventorySettingsSummary {
  branchId: string;
  branchName: string;
  defaultLocationName?: string;
  minStock: number;
  reorderPoint?: number;
}

export interface ProductInventoryStockSummary {
  branchId: string;
  branchName: string;
  /** Agregado fisico del DTO stock/batch; no representa por si solo lo vendible. */
  item: InventoryStockBatchItem;
  /** Balance vendible objetivo segun capacidad/asignacion; null si no pudo validarse con seguridad. */
  operational: {
    locationId: string | null;
    locationName?: string;
    legacyUnlocated: boolean;
    quantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  } | null;
}

export interface ProductSupplierSummaryItem {
  supplier: OperationalSupplier;
  supplierProduct: SupplierProduct;
  purchaseUnitName?: string;
}

export interface ProductQuickViewModel extends ProductDetailViewModel {
  inventory: ProductInventorySummaryItem[];
  inventorySettings: ProductInventorySettingsSummary | null;
  inventorySettingsAvailable: boolean;
  /** Existencias de la sucursal activa; null si no aplica, no hay datos o la lectura fallo. */
  inventoryStock: ProductInventoryStockSummary | null;
  /** true solo si la lectura de existencias fallo; el resto del Quick View sigue siendo valido. */
  inventoryStockFailed: boolean;
  suppliers: ProductSupplierSummaryItem[];
  suppliersAvailable: boolean;
  promotions: Promotion[];
}
