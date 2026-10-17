import type { Product, StorageLocation } from "@/core/entities";
import { LocationStatus, ProductType } from "@/core/enums";
import { getProductMediaSource, selectPrimaryProductMedia } from "@/core/media/catalogImage";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  REFERENCE_DATA_TTL_MS,
  getReferenceDataCache,
  referenceDataKeys,
} from "@/shared/utils/requestCache";
import type {
  ProductEditorData,
  ProductMediaEditorValue,
  SupplierProductEditorValue,
} from "@/modules/catalog/application/dto/ProductEditorDto";
import {
  ensureCanReadProducts,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class GetProductEditorDataService {
  private readonly kitEligibleLoads = new Map<string, Promise<Product[]>>();
  private readonly locationLoads = new Map<
    string,
    Promise<{ branchLocations: StorageLocation[]; storageLocations: StorageLocation[] }>
  >();

  private readonly referenceCache;

  constructor(private readonly repositories: RepositoryRegistry) {
    this.referenceCache = getReferenceDataCache(repositories);
  }

  async execute(productId?: string): Promise<ProductEditorData> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanReadProducts(permissions);
    const apiMode = this.repositories.productRelationsDataSource === "api";
    const hasPermission = (permission: string) => permissions.includes(permission);
    const access: ProductEditorData["access"] = {
      apiMode,
      canUpdateProductRelations: !apiMode || hasPermission("catalog.products.update"),
      canReadConversions: !apiMode || hasPermission("catalog.units.read"),
      canManageConversions: !apiMode || hasPermission("catalog.units.manage"),
      canReadAttributes: !apiMode || hasPermission("catalog.attributes.read"),
      canManageAttributes: !apiMode || hasPermission("catalog.attributes.manage"),
      canManageSuppliers: !apiMode || hasPermission("admin.suppliers.manage"),
      canReadLocations:
        !apiMode ||
        hasPermission("catalog.locations.read") ||
        hasPermission("catalog.locations.manage"),
      canReadInventorySettings: !apiMode || hasPermission("inventory.stock.read"),
      canReadPromotions: !apiMode || hasPermission("catalog.promotions.read"),
      canManagePromotions: !apiMode || hasPermission("catalog.promotions.manage"),
    };
    // El editor necesita el Product scoped y su media para conservar todo el estado editable.
    // Category y Unit no se muestran como entidades en el primer paint y no se leen aqui.
    const detailLoadPromise = productId
      ? this.loadEditorDetailWithMedia(tenantId, productId)
      : Promise.resolve(null);
    const suppliersPromise = access.canManageSuppliers
      ? this.referenceCache.getOrLoad(
          referenceDataKeys.activeSuppliers(tenantId),
          REFERENCE_DATA_TTL_MS,
          () => this.repositories.suppliers.getActiveByTenant(tenantId),
        )
      : Promise.resolve([]);
    // Las relaciones dependen de un Product scoped valido, pero no de suppliers ni locations.
    // Comienzan apenas termina Product Detail mientras esos masters siguen cargando. Attributes,
    // price tiers, promotions, conversions e inventory settings quedan fuera y se hidratan al
    // abrir sus pestanas.
    const relationsPromise = detailLoadPromise.then(async (detailLoad) => {
      if (!productId || !detailLoad) return null;
      const { detail } = detailLoad;
      const supplierProductsPromise = (
        detail.product.productType !== ProductType.kit && access.canManageSuppliers
          ? this.repositories.supplierProducts
              .getAllByProductForTenant(tenantId, productId)
              .then((items) => items.filter((item) => item.active))
          : Promise.resolve([])
      ).then((supplierProducts) =>
        supplierProducts.map(
          (supplierProduct): SupplierProductEditorValue => ({
            id: supplierProduct.id,
            supplierId: supplierProduct.supplierId,
            supplierSku: supplierProduct.supplierSku,
            purchaseUnitId: supplierProduct.purchaseUnitId,
            purchaseToBaseFactor: supplierProduct.purchaseToBaseFactor,
            lastCost: supplierProduct.lastCost,
            leadTimeDays: supplierProduct.leadTimeDays,
            minimumOrderQuantity: supplierProduct.minimumOrderQuantity,
            preferred: supplierProduct.preferred,
            active: supplierProduct.active,
            costTiers: undefined,
          }),
        ),
      );
      const [supplierProducts, kitComponents] = await Promise.all([
        supplierProductsPromise,
        detail.product.productType === ProductType.kit
          ? this.repositories.productKitComponents.getByKitProduct(productId)
          : Promise.resolve([]),
      ]);
      return {
        supplierProducts,
        kitComponents,
      };
    });

    const [
      detailLoad,
      suppliers,
      relations,
    ] = await Promise.all([
      detailLoadPromise,
      suppliersPromise,
      relationsPromise,
    ]);

    if (!detailLoad || !relations) {
      return {
        access,
        detail: null,
        unitConversion: undefined,
        unitConversions: undefined,
        inventorySettings: undefined,
        storageLocations: [],
        branchLocations: [],
        currentDefaultLocation: undefined,
        attributeDefinitions: undefined,
        attributes: undefined,
        salesPriceTiers: undefined,
        suppliers,
        supplierProducts: [],
        media: [],
        promotionCount: undefined,
        kitComponents: [],
        kitEligibleProducts: [],
      };
    }

    const { detail, media } = detailLoad;
    const editableMedia: ProductMediaEditorValue[] = media.map((item) => ({
      id: item.id,
      type: item.type,
      url: item.url,
      source: item.source,
      alt: item.alt,
      isPrimary: item.isPrimary,
      sortOrder: item.sortOrder,
    }));

    return {
      access,
      detail,
      unitConversion: undefined,
      unitConversions: undefined,
      inventorySettings: undefined,
      storageLocations: [],
      branchLocations: [],
      currentDefaultLocation: undefined,
      attributeDefinitions: undefined,
      attributes: undefined,
      salesPriceTiers: undefined,
      suppliers,
      supplierProducts: relations.supplierProducts,
      media: editableMedia,
      promotionCount: undefined,
      kitComponents: relations.kitComponents.map((component) => ({
        componentProductId: component.componentProductId,
        quantityPerKit: component.quantityPerKit,
      })),
      kitEligibleProducts: [],
    };
  }

  async getKitEligibleProducts(excludeProductId?: string): Promise<Product[]> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanReadProducts(permissions);
    const key = `${tenantId}:${excludeProductId ?? "new"}`;
    const existing = this.kitEligibleLoads.get(key);
    if (existing) return existing;

    const load = this.repositories.products
      .getByTenant(tenantId)
      .then((products) =>
        products.filter(
          (product) =>
            product.id !== excludeProductId &&
            product.productType === ProductType.physical &&
            product.tracking.stock,
        ),
      )
      .catch((error) => {
        this.kitEligibleLoads.delete(key);
        throw error;
      });
    this.kitEligibleLoads.set(key, load);
    return load;
  }

  invalidateKitEligibleProducts(tenantId?: string): void {
    if (!tenantId) {
      this.kitEligibleLoads.clear();
      return;
    }
    for (const key of this.kitEligibleLoads.keys()) {
      if (key.startsWith(`${tenantId}:`)) this.kitEligibleLoads.delete(key);
    }
  }

  async getLocations(
    branchId: string,
  ): Promise<{ branchLocations: StorageLocation[]; storageLocations: StorageLocation[] }> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanReadProducts(permissions);
    const apiMode = this.repositories.productRelationsDataSource === "api";
    const canReadLocations =
      !apiMode ||
      permissions.includes("catalog.locations.read") ||
      permissions.includes("catalog.locations.manage");
    if (!canReadLocations) return { branchLocations: [], storageLocations: [] };

    const key = `${tenantId}:${branchId}`;
    const existing = this.locationLoads.get(key);
    if (existing) return existing;

    const load = this.repositories.branches
      .getByIdScoped(tenantId, branchId)
      .then(async (branch) => {
        if (!branch || branch.tenantId !== tenantId) {
          return { branchLocations: [], storageLocations: [] };
        }
        const branchLocations = await this.referenceCache.getOrLoad(
          referenceDataKeys.locations(tenantId, branch.id),
          REFERENCE_DATA_TTL_MS,
          () => this.repositories.inventory.getLocations(branch.id),
        );
        return {
          branchLocations,
          storageLocations: branchLocations.filter(
            (location) =>
              location.tenantId === tenantId && location.status === LocationStatus.active,
          ),
        };
      })
      .catch((error) => {
        this.locationLoads.delete(key);
        throw error;
      });
    this.locationLoads.set(key, load);
    return load;
  }

  private async loadEditorDetailWithMedia(tenantId: string, productId: string) {
    const product = await this.repositories.products.getByIdScoped(tenantId, productId);
    if (!product) return null;
    const media = await this.repositories.productMedia.getByProduct(product.id, product.tenantId);
    const primaryMedia = selectPrimaryProductMedia(
      media.filter((item) => item.tenantId === product.tenantId),
    );
    return {
      detail: {
        product,
        imageSource: primaryMedia ? (getProductMediaSource(primaryMedia) ?? undefined) : undefined,
        category: null,
        unit: null,
      },
      media,
    };
  }
}
