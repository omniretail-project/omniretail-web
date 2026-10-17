import type { InventoryBalance, StorageLocation, SupplierProduct } from "@/core/entities";
import { LocationStatus, ProductType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetProductDetailService } from "@/modules/catalog/application/services/GetProductDetailService";
import { resolveTenantContext } from "@/modules/catalog/application/services/serviceHelpers";
import type {
  ProductInventorySummaryItem,
  ProductQuickViewModel,
  ProductSupplierSummaryItem,
} from "@/modules/catalog/types/catalog.types";

import {
  REFERENCE_DATA_TTL_MS,
  getReferenceDataCache,
  referenceDataKeys,
} from "@/shared/utils/requestCache";

interface QuickViewBranchContext {
  id: string;
  tenantId: string;
  name: string;
}

export class GetProductQuickViewService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    productId: string,
    branch?: QuickViewBranchContext,
  ): Promise<ProductQuickViewModel | null> {
    const detail = await new GetProductDetailService(this.repositories).execute(productId);
    if (!detail) return null;
    if (this.repositories.productRelationsDataSource === "api") {
      const { permissions } = await resolveTenantContext(this.repositories);
      const tenantId = detail.product.tenantId;
      const canReadInventory = permissions.includes("inventory.stock.read");
      const canReadLocations =
        permissions.includes("catalog.locations.read") ||
        permissions.includes("catalog.locations.manage");
      const canReadSuppliers = permissions.includes("admin.suppliers.manage");
      const canReadUnits = permissions.includes("catalog.units.read");
      const validBranch = branch?.tenantId === tenantId ? branch : undefined;
      const inventoryApplies =
        detail.product.productType === ProductType.physical && detail.product.tracking.stock;

      const canReadStock = Boolean(inventoryApplies && validBranch && canReadInventory);

      const [inventorySettings, capabilities, stockBatchRead, supplierProducts, suppliers, units] =
        await Promise.all([
          canReadStock && validBranch
            ? this.repositories.inventory.getProductInventorySettings(productId, validBranch.id)
            : Promise.resolve(null),
          canReadStock
            ? this.repositories.businessConfig.getCapabilities(tenantId)
            : Promise.resolve(null),
          canReadStock && validBranch
            ? this.repositories.inventory
                .getStockBatch({ branchId: validBranch.id, productIds: [productId] })
                .then(
                  (result) => ({
                    failed: false,
                    item: result.items.find((stock) => stock.productId === productId) ?? null,
                  }),
                  () => ({ failed: true, item: null }),
                )
            : Promise.resolve({ failed: false, item: null }),
          canReadSuppliers
            ? this.repositories.supplierProducts
                .getAllByProductForTenant(tenantId, productId)
                .then((items) => items.filter((item) => item.active))
            : Promise.resolve([]),
          canReadSuppliers
            ? this.repositories.suppliers.listByTenant(tenantId)
            : Promise.resolve([]),
          canReadSuppliers && canReadUnits
            ? this.repositories.units.getActiveByTenant(tenantId)
            : Promise.resolve([]),
        ]);
      const operationalRead =
        canReadStock && validBranch
          ? await loadQuickViewOperationalInventory({
              repositories: this.repositories,
              tenantId,
              branchId: validBranch.id,
              productId,
              supportsMultipleLocations: capabilities?.supportsMultipleLocations ?? false,
              defaultLocationId: inventorySettings?.defaultLocationId ?? null,
              canReadLocations,
            })
          : { failed: false, balances: [] as InventoryBalance[], defaultLocation: undefined };
      const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
      const defaultLocation = operationalRead.defaultLocation;
      const operationalStock = operationalRead.failed
        ? null
        : resolveQuickViewOperationalStock({
            balances: operationalRead.balances,
            supportsMultipleLocations: capabilities?.supportsMultipleLocations ?? false,
            defaultLocationId: inventorySettings?.defaultLocationId ?? null,
            defaultLocation,
          });

      return {
        ...detail,
        inventory: [],
        inventorySettings:
          inventorySettings && validBranch
            ? {
                branchId: validBranch.id,
                branchName: validBranch.name,
                defaultLocationName: defaultLocation?.name,
                minStock: inventorySettings.minStock,
                reorderPoint: inventorySettings.reorderPoint,
              }
            : null,
        inventorySettingsAvailable: canReadStock,
        inventoryStock:
          stockBatchRead.item && validBranch
            ? {
                branchId: validBranch.id,
                branchName: validBranch.name,
                item: stockBatchRead.item,
                operational: operationalStock,
              }
            : null,
        inventoryStockFailed: stockBatchRead.failed || operationalRead.failed,
        suppliers: supplierProducts
          .map<ProductSupplierSummaryItem | null>((supplierProduct) => {
            const supplier = suppliers.find((item) => item.id === supplierProduct.supplierId);
            if (!supplier) return null;
            return {
              supplier,
              supplierProduct,
              purchaseUnitName: unitNames.get(supplierProduct.purchaseUnitId),
            };
          })
          .filter((item): item is ProductSupplierSummaryItem => Boolean(item)),
        suppliersAvailable: canReadSuppliers,
        promotions: [],
      };
    }
    const tenantId = detail.product.tenantId;

    const [balances, branches, locations, suppliers, units, promotions] = await Promise.all([
      this.repositories.inventory.getBalanceByProduct(productId),
      this.repositories.branches.getActiveByTenant(tenantId),
      this.repositories.inventory.getLocations(),
      this.repositories.suppliers.getActiveByTenant(tenantId),
      this.repositories.units.getActiveByTenant(tenantId),
      this.repositories.promotions.getByProductScoped(tenantId, productId),
    ]);

    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
    const locationNames = new Map(
      locations
        .filter((location) => location.tenantId === tenantId)
        .map((location) => [location.id, location.name]),
    );
    const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
    const supplierProducts = await this.getSupplierProducts(tenantId, productId);

    return {
      ...detail,
      inventorySettings: null,
      inventorySettingsAvailable: true,
      inventoryStock: null,
      inventoryStockFailed: false,
      inventory: balances
        .filter((balance) => balance.tenantId === tenantId)
        .map<ProductInventorySummaryItem>((balance) => ({
          balance,
          branchName: branchNames.get(balance.branchId) ?? "Sucursal no disponible",
          locationName: balance.locationId ? locationNames.get(balance.locationId) : undefined,
          stockStatus: getStockStatus(
            balance.quantity - balance.reservedQuantity,
            balance.minStock,
          ),
        })),
      suppliers: supplierProducts
        .map<ProductSupplierSummaryItem | null>((supplierProduct) => {
          const supplier = suppliers.find((item) => item.id === supplierProduct.supplierId);
          if (!supplier) return null;
          return {
            supplier,
            supplierProduct,
            purchaseUnitName: supplierProduct.purchaseUnitId
              ? unitNames.get(supplierProduct.purchaseUnitId)
              : undefined,
          };
        })
        .filter((item): item is ProductSupplierSummaryItem => Boolean(item)),
      suppliersAvailable: true,
      promotions,
    };
  }

  private async getSupplierProducts(tenantId: string, productId: string) {
    const suppliers = await this.repositories.suppliers.getActiveByTenant(tenantId);
    const entries = await Promise.all(
      suppliers.map((supplier) => this.repositories.suppliers.getProductsBySupplier(supplier.id)),
    );

    return entries
      .flat()
      .filter(
        (supplierProduct: SupplierProduct) =>
          supplierProduct.tenantId === tenantId && supplierProduct.productId === productId,
      );
  }
}

function getStockStatus(availableQuantity: number, minStock?: number) {
  if (availableQuantity <= 0) return "Sin stock";
  if (typeof minStock === "number" && availableQuantity <= minStock) return "Bajo";
  return "Disponible";
}

export async function loadQuickViewOperationalInventory(input: {
  repositories: RepositoryRegistry;
  tenantId: string;
  branchId: string;
  productId: string;
  supportsMultipleLocations: boolean;
  defaultLocationId: string | null;
  canReadLocations: boolean;
}): Promise<{
  failed: boolean;
  balances: InventoryBalance[];
  defaultLocation: StorageLocation | undefined;
}> {
  const mustValidateAssignedLocation = Boolean(
    input.supportsMultipleLocations && input.defaultLocationId && input.canReadLocations,
  );
  // Sin permiso para validar una asignacion fisica no se solicita ni se expone su saldo. En los
  // demas casos el balance es necesario: ubicacion asignada, o balance NULL legacy.
  const needsBalances =
    !input.supportsMultipleLocations || !input.defaultLocationId || input.canReadLocations;
  const [balanceRead, locationRead] = await Promise.all([
    needsBalances
      ? input.repositories.inventory
          .getProductBalances(input.productId, input.branchId, input.tenantId)
          .then(
            (balances) => ({ failed: false, balances }),
            () => ({ failed: true, balances: [] as InventoryBalance[] }),
          )
      : Promise.resolve({ failed: false, balances: [] as InventoryBalance[] }),
    mustValidateAssignedLocation
      ? getReferenceDataCache(input.repositories)
          .getOrLoad(
            referenceDataKeys.locations(input.tenantId, input.branchId),
            REFERENCE_DATA_TTL_MS,
            () => input.repositories.inventory.getLocations(input.branchId),
          )
          .then(
            (locations) => ({
              failed: false,
              location: locations.find((location) => location.id === input.defaultLocationId),
            }),
            () => ({ failed: true, location: undefined }),
          )
      : Promise.resolve({ failed: false, location: undefined }),
  ]);
  return {
    failed: balanceRead.failed || locationRead.failed,
    balances: balanceRead.balances,
    defaultLocation: locationRead.location,
  };
}

export function resolveQuickViewOperationalStock(input: {
  balances: InventoryBalance[];
  supportsMultipleLocations: boolean;
  defaultLocationId: string | null;
  defaultLocation?: StorageLocation;
}) {
  const targetLocationId = input.supportsMultipleLocations ? input.defaultLocationId : null;
  // Una asignacion no verificable no debe presentarse como vendible. Esto incluye permisos sin
  // lectura de ubicaciones, una ubicacion archivada o una respuesta inconsistente del backend.
  if (targetLocationId && !input.defaultLocation) return null;
  if (
    input.supportsMultipleLocations &&
    !targetLocationId &&
    !input.balances.some((balance) => !balance.locationId)
  ) {
    return null;
  }
  const targetBalances = input.balances.filter(
    (balance) => (balance.locationId ?? null) === targetLocationId,
  );
  const quantity = targetBalances.reduce((total, balance) => total + balance.quantity, 0);
  const reservedQuantity = targetBalances.reduce(
    (total, balance) => total + balance.reservedQuantity,
    0,
  );
  const usable = !targetLocationId || input.defaultLocation?.status === LocationStatus.active;
  return {
    locationId: targetLocationId,
    locationName: input.defaultLocation?.name,
    legacyUnlocated: targetLocationId === null,
    quantity,
    reservedQuantity,
    availableQuantity: usable ? Math.max(0, quantity - reservedQuantity) : 0,
  };
}
