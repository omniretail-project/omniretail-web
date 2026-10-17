import type {
  AttributeDefinition,
  ProductMedia,
  Product,
  ProductInventorySettings,
  ProductSalesPriceTier,
  StorageLocation,
  SupplierCostTier,
  SupplierProduct,
  UnitConversion,
} from "@/core/entities";
import type { OperationalSupplier } from "@/core/repositories";
import type { CreateProductDto } from "@/modules/catalog/application/dto/CreateProductDto";
import type { ProductDetailViewModel } from "@/modules/catalog/types/catalog.types";
import type { NumericInputValue } from "@/shared/utils/numberInput";
import type { ImageUploadDraft } from "@/shared/application/dto/ImageUploadDraft";

export interface ProductAttributeEditorValue {
  attributeDefinitionId?: string;
  name: string;
  value: string;
}

export type ProductSalesPriceTierEditorValue = Omit<
  Pick<ProductSalesPriceTier, "minQuantity" | "unitPrice" | "active">,
  "minQuantity" | "unitPrice"
> & {
  id?: string;
  minQuantity: NumericInputValue;
  unitPrice: NumericInputValue;
};

export type SupplierCostTierEditorValue = Omit<
  Pick<SupplierCostTier, "minQuantity" | "unitCost">,
  "minQuantity" | "unitCost"
> & {
  id?: string;
  minQuantity: NumericInputValue;
  unitCost: NumericInputValue;
};

export type SupplierProductEditorValue = Omit<
  Pick<
    SupplierProduct,
    | "supplierId"
    | "supplierSku"
    | "purchaseUnitId"
    | "lastCost"
    | "leadTimeDays"
    | "minimumOrderQuantity"
    | "preferred"
    | "active"
  >,
  "lastCost" | "leadTimeDays" | "minimumOrderQuantity"
> & {
  id?: string;
  purchaseToBaseFactor: NumericInputValue;
  lastCost: NumericInputValue;
  leadTimeDays: NumericInputValue;
  minimumOrderQuantity: NumericInputValue;
  /** undefined = todavia no cargados; [] = cargados y vacios. */
  costTiers?: SupplierCostTierEditorValue[];
};

export type ProductMediaEditorValue = Pick<
  ProductMedia,
  "type" | "url" | "source" | "alt" | "isPrimary" | "sortOrder"
> & {
  id?: string;
  pendingUpload?: ImageUploadDraft;
};

export interface ProductInventorySettingsEditorValue {
  branchId: string;
  minStock: NumericInputValue;
  /** "" o ausente = sin punto de reorden configurado; 0 es un valor valido. */
  reorderPoint?: NumericInputValue;
  defaultLocationId: string;
}

export interface ProductKitComponentEditorValue {
  componentProductId: string;
  quantityPerKit: NumericInputValue;
}

export interface ProductEditorDto extends Omit<CreateProductDto, "primaryImageUrl" | "salePrice"> {
  inventoryUnitId: string;
  salePrice: NumericInputValue;
  inventoryToBaseFactor: NumericInputValue;
  saleToBaseFactor: NumericInputValue;
  /** undefined = conversiones todavia no cargadas; [] = cargadas y vacias. */
  unitConversions?: UnitConversion[];
  /** undefined = settings todavia no cargados. */
  inventorySettings?: ProductInventorySettingsEditorValue;
  /** undefined = todavia no cargados; [] = cargados y sin asignaciones. */
  attributes?: ProductAttributeEditorValue[];
  /** undefined = todavia no cargados; [] = cargados y sin tramos. */
  salesPriceTiers?: ProductSalesPriceTierEditorValue[];
  supplierProducts: SupplierProductEditorValue[];
  media: ProductMediaEditorValue[];
  kitComponents: ProductKitComponentEditorValue[];
}

export interface ProductEditorData {
  access: {
    apiMode: boolean;
    canUpdateProductRelations: boolean;
    canReadConversions: boolean;
    canManageConversions: boolean;
    canReadAttributes: boolean;
    canManageAttributes: boolean;
    canManageSuppliers: boolean;
    canReadLocations: boolean;
    canReadInventorySettings: boolean;
    canReadPromotions: boolean;
    canManagePromotions: boolean;
  };
  detail: ProductDetailViewModel | null;
  unitConversion?: UnitConversion | null;
  unitConversions?: UnitConversion[];
  inventorySettings?: ProductInventorySettings | null;
  storageLocations: StorageLocation[];
  branchLocations: StorageLocation[];
  currentDefaultLocation?: StorageLocation | null;
  attributeDefinitions?: AttributeDefinition[];
  attributes?: ProductAttributeEditorValue[];
  salesPriceTiers?: ProductSalesPriceTierEditorValue[];
  suppliers: OperationalSupplier[];
  supplierProducts: SupplierProductEditorValue[];
  media: ProductMediaEditorValue[];
  promotionCount?: number;
  kitComponents: ProductKitComponentEditorValue[];
  kitEligibleProducts: Product[];
}
