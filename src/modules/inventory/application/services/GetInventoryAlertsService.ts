import {
  InventoryTransferRequestStatus,
  ProductStatus,
  ProductType,
  SerialStatus,
} from "@/core/enums";
import type {
  InventoryBalance,
  InventoryTransferRequest,
  Product,
  StockLot,
  StorageLocation,
  Unit,
} from "@/core/entities";
import type {
  InventoryAlertListItem,
  InventoryStockDisplayStatus,
  InventoryStockListItem,
  InventoryStockProductType,
  InventoryStockSort,
  TrackedInventoryStockItem,
} from "@/core/repositories";
import {
  getBranchAvailableQuantity,
  selectOperationalBalances,
} from "@/core/inventory/stockAvailability";
import { fromBaseQuantity, resolveUnitConversion } from "@/core/units";
import { canUserOperateBranch } from "@/core/scopes/userBranchAccess";
import {
  REFERENCE_DATA_TTL_MS,
  getReferenceDataCache,
  referenceDataKeys,
} from "@/shared/utils/requestCache";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  InventoryAlert,
  InventoryAlertsData,
  InventoryLookupMaps,
  InventoryProductRow,
  InventoryStatus,
  InventoryTransferRequestRow,
  ProductWithStock,
} from "@/modules/inventory/application/dto/InventoryAlertsDto";
import { assignedLocationKey } from "@/modules/inventory/application/dto/InventoryAlertsDto";
import {
  ensureCanReadStock,
  ensureUserCanOperateInventoryBranch,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";

const EXPIRING_SOON_DAYS = 30;
const NEAR_MINIMUM_RATIO = 1.25;
const TRANSFER_RESPONSE_ALERT_DAYS = 14;

export class GetInventoryAlertsService {
  private readonly referenceCache;

  constructor(private readonly repositories: RepositoryRegistry) {
    this.referenceCache = getReferenceDataCache(repositories);
  }

  async execute(input: string | GetInventoryAlertsParams): Promise<InventoryAlertsData> {
    if (typeof input === "string") return this.getMockData(input);
    if (this.repositories.inventoryStockDataSource === "api") return this.getApiPage(input);
    return this.getMockData(input.branchId);
  }

  async getApiAlerts(params: Pick<GetInventoryAlertsParams, "branchId" | "branchName">) {
    if (this.repositories.inventoryStockDataSource !== "api") {
      return { items: [], page: 1, pageSize: API_PAGE_SIZE, totalItems: 0, totalPages: 0 };
    }
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, params.branchId);
    const [units, { supportsMultipleLocations, locations }, page] = await Promise.all([
      this.getUnits(tenantId),
      this.getLocationsIfSupported(tenantId, params.branchId),
      this.repositories.inventory.getInventoryAlertPage({
        branchId: params.branchId,
        page: 1,
        pageSize: API_PAGE_SIZE,
      }),
    ]);
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const locationById = new Map(locations.map((location) => [location.id, location]));
    return {
      ...page,
      items: page.items.map((item) =>
        mapApiAlert(
          item,
          tenantId,
          params.branchName,
          unitById,
          locationById,
          supportsMultipleLocations,
        ),
      ),
    };
  }

  async getApiProductRow({
    branchId,
    branchName,
    productId,
  }: Pick<GetInventoryAlertsParams, "branchId" | "branchName"> & { productId: string }) {
    if (this.repositories.inventoryStockDataSource !== "api") return null;
    const { tenantId, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    const product = await this.repositories.products.getById(productId);
    if (!product || product.tenantId !== tenantId) return null;
    const [result, units] = await Promise.all([
      this.repositories.inventory.getStockPage({
        branchId,
        search: product.sku,
        productTypes: INVENTORY_PRODUCT_TYPES,
        page: 1,
        pageSize: API_PAGE_SIZE,
        sort: DEFAULT_API_SORT,
      }),
      this.getUnits(tenantId),
    ]);
    const item = result.items.find((candidate) => candidate.productId === productId);
    if (!item) return null;
    return mapApiStockRow(
      item,
      tenantId,
      branchName,
      new Map(units.map((unit) => [unit.id, unit])),
    );
  }

  async getApiTransferRequests(
    params: Pick<GetInventoryAlertsParams, "branchId" | "branchName">,
  ): Promise<InventoryTransferRequestRow[]> {
    if (this.repositories.inventoryTransfersDataSource !== "api") return [];
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, params.branchId);

    const [providedRequests, requestedTransfers, branches] = await Promise.all([
      this.repositories.inventoryTransferRequests.getRequests({
        tenantId,
        sourceBranchId: params.branchId,
      }),
      this.repositories.inventoryTransferRequests.getRequests({
        tenantId,
        requestingBranchId: params.branchId,
      }),
      this.repositories.branches.getAll(),
    ]);
    const receivedRequests = providedRequests.filter(
      (request) => request.status === InventoryTransferRequestStatus.requested,
    );
    const responseRequests = filterRecentTransferResponses(
      requestedTransfers.filter(
        (request) =>
          request.status === InventoryTransferRequestStatus.approved ||
          request.status === InventoryTransferRequestStatus.rejected,
      ),
    );
    const productIds = [
      ...new Set([...receivedRequests, ...responseRequests].map((request) => request.productId)),
    ];
    const products = (
      await Promise.all(
        productIds.map((productId) => this.repositories.products.getById(productId)),
      )
    ).filter((product): product is Product => Boolean(product && product.tenantId === tenantId));
    const physicalReceivedProductIds = [
      ...new Set(
        receivedRequests
          .filter((request) =>
            products.some(
              (product) => product.id === request.productId && isOperationalStockProduct(product),
            ),
          )
          .map((request) => request.productId),
      ),
    ];
    const stock = physicalReceivedProductIds.length
      ? await this.repositories.inventory.getStockBatch({
          branchId: params.branchId,
          productIds: physicalReceivedProductIds,
        })
      : { branchId: params.branchId, items: [] };
    const branchNames = new Map(
      branches
        .filter((branch) => branch.tenantId === tenantId)
        .map((branch) => [branch.id, branch.name]),
    );
    if (!branchNames.has(params.branchId)) branchNames.set(params.branchId, params.branchName);
    const productById = new Map(products.map((product) => [product.id, product]));
    const availabilityByProduct = new Map(
      stock.items.map((item) => [item.productId, item.availableQuantity]),
    );

    return [
      ...buildApiTransferRequestRows(
        receivedRequests,
        "received",
        productById,
        branchNames,
        availabilityByProduct,
      ),
      ...buildApiTransferRequestRows(
        responseRequests,
        "response",
        productById,
        branchNames,
        availabilityByProduct,
      ),
    ];
  }

  private async getApiPage(params: GetInventoryAlertsParams): Promise<InventoryAlertsData> {
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, params.branchId);
    const [result, categories, units, { supportsMultipleLocations, locations }, transferRequests] =
      await Promise.all([
        this.repositories.inventory.getStockPage({
          branchId: params.branchId,
          search: params.search,
          categoryId: params.categoryId,
          // "low_stock" es solo de UI: viaja como lowStock=true y nunca junto a un status.
          ...(params.status === "low_stock" ? { lowStock: true } : { status: params.status }),
          productTypes: INVENTORY_PRODUCT_TYPES,
          page: params.page,
          pageSize: params.pageSize,
          sort: params.sort,
        }),
        this.getCategories(tenantId),
        this.getUnits(tenantId),
        this.getLocationsIfSupported(tenantId, params.branchId),
        this.getApiTransferRequests(params),
      ]);
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    return {
      supportsMultipleLocations,
      rows: result.items.map((item) => mapApiStockRow(item, tenantId, params.branchName, unitById)),
      alerts: [],
      alertTotalItems: 0,
      transferRequests,
      kpis: {
        activeProducts: result.summary.activeProducts,
        lowStock: result.summary.lowStock,
        expiringSoon: 0,
        outOfStock: result.summary.outOfStock,
      },
      visibility: {
        supportsExpiration: false,
        hasExpirationProducts: false,
        showExpirationFeatures: false,
      },
      branches: [],
      categories,
      locations,
      page: result.page,
      pageSize: result.pageSize,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
    };
  }

  private getCategories(tenantId: string) {
    return this.referenceCache.getOrLoad(
      referenceDataKeys.categories(tenantId),
      REFERENCE_DATA_TTL_MS,
      () => this.repositories.categories.getByTenant(tenantId),
    );
  }

  private getUnits(tenantId: string) {
    return this.referenceCache.getOrLoad(
      referenceDataKeys.units(tenantId),
      REFERENCE_DATA_TTL_MS,
      () => this.repositories.units.getByTenant(tenantId),
    );
  }

  /**
   * Solo la dependencia de ubicaciones depende de "Multiples ubicaciones": con la capacidad apagada
   * el backend rechaza /catalog/locations y el stock por sucursal no la necesita. La capacidad se
   * lee en cada carga (sin cache). Sin configuracion se asume ON para no ocultar datos en silencio.
   * Los errores de ubicaciones con la capacidad ON siguen propagandose.
   */
  private async getLocationsIfSupported(tenantId: string, branchId: string) {
    const capabilities = await this.repositories.businessConfig.getCapabilities(tenantId);
    const supportsMultipleLocations = capabilities?.supportsMultipleLocations ?? true;
    if (!supportsMultipleLocations) {
      // Al volver a ON se piden las ubicaciones actuales, no las cacheadas de antes del cambio.
      this.referenceCache.invalidate(referenceDataKeys.locations(tenantId, branchId));
      return { supportsMultipleLocations, locations: [] as StorageLocation[] };
    }
    return { supportsMultipleLocations, locations: await this.getLocations(tenantId, branchId) };
  }

  private getLocations(tenantId: string, branchId: string) {
    return this.referenceCache.getOrLoad(
      referenceDataKeys.locations(tenantId, branchId),
      REFERENCE_DATA_TTL_MS,
      () => this.repositories.inventory.getLocations(branchId),
    );
  }

  private async getMockData(branchId: string): Promise<InventoryAlertsData> {
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, branchId);

    const [
      products,
      branches,
      categories,
      units,
      allLocations,
      balances,
      receivedTransferRequests,
      approvedTransferResponses,
      rejectedTransferResponses,
      serials,
    ] = await Promise.all([
      this.repositories.products.getAll(),
      this.repositories.branches.getActive(),
      this.repositories.categories.getAll(),
      this.repositories.units.getAll(),
      this.repositories.inventory.getLocations(),
      this.repositories.inventory.getBalances(),
      this.repositories.inventoryTransferRequests.getRequests({
        tenantId,
        sourceBranchId: branchId,
        status: InventoryTransferRequestStatus.requested,
      }),
      this.repositories.inventoryTransferRequests.getRequests({
        tenantId,
        requestingBranchId: branchId,
        status: InventoryTransferRequestStatus.approved,
      }),
      this.repositories.inventoryTransferRequests.getRequests({
        tenantId,
        requestingBranchId: branchId,
        status: InventoryTransferRequestStatus.rejected,
      }),
      this.repositories.inventory.getSerialNumbers(),
    ]);
    const tenantBranches = branches.filter((branch) => branch.tenantId === tenantId);
    const visibleBranches = tenantBranches.filter((branch) => canUserOperateBranch(user, branch));
    const tenantLocations = allLocations.filter((location) => location.tenantId === tenantId);
    const tenantProducts = products.filter((product) => product.tenantId === tenantId);
    const branchProducts = tenantProducts.filter(isOperationalStockProduct);
    const kits = tenantProducts.filter(
      (product) =>
        product.status === ProductStatus.published && product.productType === ProductType.kit,
    );
    const capabilities = await this.repositories.businessConfig.getCapabilities(tenantId);
    const visibility = getVisibilityFlags(
      capabilities?.supportsExpiration ?? false,
      tenantProducts,
    );
    const requiresLotsForAvailability = branchProducts.some((product) => product.tracking.lot);
    const lots = requiresLotsForAvailability ? await this.repositories.inventory.getLots() : [];
    const kitComponents = await Promise.all(
      kits.map((kit) => this.repositories.productKitComponents.getByKitProduct(kit.id)),
    );
    const settingsEntries = await Promise.all(
      branchProducts.map(
        async (product) =>
          [
            product.id,
            await this.repositories.inventory.getProductInventorySettings(product.id, branchId),
          ] as const,
      ),
    );
    // Ubicacion operativa de cada producto en TODAS las sucursales: la disponibilidad comercial
    // (propia, de otras sucursales y de proveedoras) usa solo esa ubicacion.
    const assignedEntries = await Promise.all(
      tenantBranches.flatMap((branch) =>
        branchProducts.map(async (product) => {
          const settings =
            branch.id === branchId
              ? (settingsEntries.find(([productId]) => productId === product.id)?.[1] ?? null)
              : await this.repositories.inventory.getProductInventorySettings(
                  product.id,
                  branch.id,
                );
          return [
            assignedLocationKey(branch.id, product.id),
            settings?.defaultLocationId ?? null,
          ] as const;
        }),
      ),
    );
    const maps: InventoryLookupMaps = {
      branches: new Map(tenantBranches.map((branch) => [branch.id, branch])),
      categories: new Map(categories.map((category) => [category.id, category])),
      units: new Map(units.map((unit) => [unit.id, unit])),
      locations: new Map(tenantLocations.map((location) => [location.id, location])),
      settingsByProduct: new Map(settingsEntries),
      assignedLocationIds: new Map(assignedEntries),
      lotsByProduct: groupLotsByProduct(lots.filter((lot) => lot.branchId === branchId)),
    };

    const availabilityByProduct = new Map(
      branchProducts.map((product) => [
        product.id,
        getBranchAvailableQuantity({
          tenantId,
          branchId,
          productId: product.id,
          balances,
          locations: tenantLocations,
          assignedLocationId: maps.assignedLocationIds.get(
            assignedLocationKey(branchId, product.id),
          ) ?? null,
        }),
      ]),
    );
    const productInputs = await Promise.all(
      branchProducts.map(async (product) => ({
        product,
        conversions: await this.repositories.units.getConversionsByProductScoped(
          product.tenantId,
          product.id,
        ),
        supplierProducts: await this.repositories.supplierProducts.getByProductForTenant(
          product.tenantId,
          product.id,
        ),
      })),
    );
    const physicalRows = productInputs.map(({ product, conversions, supplierProducts }) =>
      buildRow(
        product,
        branchId,
        maps,
        balances,
        serials,
        availabilityByProduct.get(product.id) ?? 0,
        conversions,
        supplierProducts,
      ),
    );
    const kitRows = kits.map((kit, index) =>
      buildKitRow(kit, kitComponents[index], availabilityByProduct, branchId, maps),
    );
    const rows = [...physicalRows, ...kitRows].sort((left, right) =>
      left.productName.localeCompare(right.productName),
    );
    const alerts = rows.flatMap((row) => [
      ...row.activeAlerts,
      ...buildAvailableElsewhereAlerts(row, balances, maps),
    ]);

    return {
      supportsMultipleLocations: capabilities?.supportsMultipleLocations ?? false,
      rows,
      alerts,
      alertTotalItems: alerts.length,
      transferRequests: [
        ...buildTransferRequestRows(receivedTransferRequests, "received", products, balances, maps),
        ...buildTransferRequestRows(
          filterRecentTransferResponses([
            ...approvedTransferResponses,
            ...rejectedTransferResponses,
          ]),
          "response",
          products,
          balances,
          maps,
        ),
      ],
      visibility,
      branches: visibleBranches,
      categories,
      locations: tenantLocations,
      kpis: {
        activeProducts: rows.length,
        lowStock: rows.filter((row) => row.status === "critical" || row.status === "near_minimum")
          .length,
        expiringSoon: visibility.showExpirationFeatures
          ? rows.filter((row) => row.tracksExpiration && isExpiringSoon(row.nextExpirationDate))
              .length
          : 0,
        outOfStock: rows.filter((row) => row.status === "out_of_stock").length,
      },
      page: 1,
      pageSize: Math.max(1, rows.length),
      totalItems: rows.length,
      totalPages: 1,
    };
  }
}

export interface GetInventoryAlertsParams {
  branchId: string;
  branchName: string;
  search?: string;
  categoryId?: string;
  /** `low_stock`: agregado de UI (near_minimum + critical); el backend lo recibe como lowStock=true. */
  status?: InventoryStatus | "low_stock";
  page: number;
  pageSize: number;
  sort?: InventoryStockSort;
}

const API_PAGE_SIZE = 100;
const DEFAULT_API_SORT = "productName,asc" as const;
/** /inventario/alertas muestra los tres tipos; /inventory/alerts y los KPIs siguen siendo fisicos. */
const INVENTORY_PRODUCT_TYPES: InventoryStockProductType[] = ["physical", "service", "kit"];

function toPhysicalDisplayStatus(status: InventoryStatus): InventoryStockDisplayStatus {
  const labels: Record<InventoryStatus, InventoryStockDisplayStatus> = {
    normal: "NORMAL",
    near_minimum: "NEAR_MINIMUM",
    critical: "CRITICAL",
    out_of_stock: "OUT_OF_STOCK",
  };
  return labels[status];
}

function mapApiStockRow(
  item: InventoryStockListItem,
  tenantId: string,
  branchName: string,
  unitById: Map<string, Unit>,
): InventoryProductRow {
  if (item.inventoryMode !== "TRACKED") {
    return buildNonStockApiRow(item, tenantId, branchName, unitById);
  }
  return buildApiRow({
    item,
    tenantId,
    branchName,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    defaultLocationName: item.defaultLocationName ?? "Sin ubicacion habitual",
    unitById,
    presentations: {
      inventoryUnitId: item.inventoryUnitId,
      saleUnitId: item.saleUnitId,
      inventoryToBaseFactor: item.inventoryToBaseFactor,
      saleToBaseFactor: item.saleToBaseFactor,
    },
  });
}

interface ApiPresentation {
  unitId: string;
  unitName: string;
  factor: number;
  /** Presentacion configurada sin equivalencia utilizable: se muestra en unidad base. */
  unavailableUnitName?: string;
}

/**
 * Presentacion (venta o inventario) de una fila API. Unidad base -> factor 1. Otra unidad solo se
 * aplica con factor positivo y unidad conocida; si no, queda en base sin inventar equivalencia.
 */
function resolveApiPresentation(
  unitId: string | undefined,
  factor: number | null | undefined,
  baseUnitId: string,
  baseUnitName: string,
  unitById: Map<string, Unit>,
): ApiPresentation {
  const base = { unitId: baseUnitId, unitName: baseUnitName, factor: 1 };
  if (!unitId || unitId === baseUnitId) return base;
  const unit = unitById.get(unitId);
  if (!unit || factor == null || !Number.isFinite(factor) || factor <= 0) {
    return { ...base, unavailableUnitName: unit?.name };
  }
  return { unitId, unitName: unit.name, factor };
}

/** base -> presentacion (cantidad / factor) con el helper de core; la base se devuelve intacta. */
function fromApiBaseQuantity(quantity: number, presentation: ApiPresentation, baseUnitId: string) {
  if (presentation.unitId === baseUnitId) return quantity;
  return fromBaseQuantity(quantity, {
    targetUnitId: presentation.unitId,
    baseUnitId,
    conversions: [
      { fromUnitId: presentation.unitId, toUnitId: baseUnitId, factor: presentation.factor },
    ],
  });
}

function mapApiAlert(
  item: InventoryAlertListItem,
  tenantId: string,
  branchName: string,
  unitById: Map<string, Unit>,
  locationById: Map<string, StorageLocation>,
  supportsMultipleLocations: boolean,
): InventoryAlert {
  const row = buildApiRow({
    item,
    tenantId,
    branchName,
    categoryId: "",
    categoryName: "No disponible",
    defaultLocationName:
      supportsMultipleLocations && item.defaultLocationId
        ? (locationById.get(item.defaultLocationId)?.name ?? "Ubicacion no disponible")
        : "Sin ubicacion habitual",
    unitById,
  });
  const alert: InventoryAlert = {
    id: `stock-${item.branchId}-${item.productId}`,
    type: "low_stock",
    productId: item.productId,
    title: item.productName,
    message: getInventoryAvailabilityAlertMessage(row),
    tone: item.status === "near_minimum" ? "warning" : "danger",
    suggestedReorder: item.suggestedReorder > 0 ? item.suggestedReorder : undefined,
  };
  row.activeAlerts = [alert];
  return { ...alert, row };
}

function buildApiRow({
  item,
  tenantId,
  branchName,
  categoryId,
  categoryName,
  defaultLocationName,
  unitById,
  presentations,
}: {
  item: TrackedInventoryStockItem | InventoryAlertListItem;
  tenantId: string;
  branchName: string;
  categoryId: string;
  categoryName: string;
  defaultLocationName: string;
  unitById: Map<string, Unit>;
  /** Solo /inventory/stock las trae; las alertas siguen mostrando la unidad base. */
  presentations?: {
    inventoryUnitId: string;
    saleUnitId: string;
    inventoryToBaseFactor: number | null;
    saleToBaseFactor: number | null;
  };
}): InventoryProductRow {
  const unit = unitById.get(item.baseUnitId);
  const unitName = unit?.name ?? item.baseUnitId;
  // quantity/reserved/available/minStock siguen en UNIDAD BASE; solo la presentacion se convierte.
  const sale = resolveApiPresentation(
    presentations?.saleUnitId,
    presentations?.saleToBaseFactor,
    item.baseUnitId,
    unitName,
    unitById,
  );
  const inventory = resolveApiPresentation(
    presentations?.inventoryUnitId,
    presentations?.inventoryToBaseFactor,
    item.baseUnitId,
    unitName,
    unitById,
  );
  return {
    productType: "physical",
    inventoryMode: "TRACKED",
    displayStatus: toPhysicalDisplayStatus(item.status),
    productId: item.productId,
    tenantId,
    sku: item.sku,
    productName: item.productName,
    categoryId,
    categoryName,
    unitId: item.baseUnitId,
    unitName,
    unitAllowsDecimals: unit?.allowsDecimals ?? false,
    saleUnitId: sale.unitId,
    saleUnitName: sale.unitName,
    sellableQuantity: fromApiBaseQuantity(item.quantity, sale, item.baseUnitId),
    sellableReservedQuantity: fromApiBaseQuantity(item.reservedQuantity, sale, item.baseUnitId),
    sellableAvailableQuantity: fromApiBaseQuantity(item.availableQuantity, sale, item.baseUnitId),
    inventoryUnitId: inventory.unitId,
    inventoryUnitName: inventory.unitName,
    inventoryPresentationQuantity: fromApiBaseQuantity(item.quantity, inventory, item.baseUnitId),
    inventoryPresentationAvailableQuantity: fromApiBaseQuantity(
      item.availableQuantity,
      inventory,
      item.baseUnitId,
    ),
    inventoryToBaseFactor: inventory.factor,
    inventoryConversionUnavailableUnitName: inventory.unavailableUnitName,
    saleConversionUnavailableUnitName: sale.unavailableUnitName,
    // Placeholder solo-base: el ajuste API valida la unidad base y consulta el Product detail.
    adjustmentUnits: [
      {
        unitId: item.baseUnitId,
        unitName,
        unitAllowsDecimals: unit?.allowsDecimals ?? false,
        toBaseFactor: 1,
        label: unitName,
      },
    ],
    branchId: item.branchId,
    branchName: branchName || "Sucursal",
    defaultLocationId: item.defaultLocationId,
    defaultLocationName,
    locationQuantities: {},
    locationAvailableQuantities: {},
    // /inventory/stock devuelve el balance OPERATIVO (ubicacion asignada, o el saldo heredado si no
    // hay asignacion): no es el inventario fisico total ni el saldo heredado. Esas cantidades solo
    // se conocen consultando los balances fisicos (bajo demanda) y hasta entonces son "no
    // disponibles", nunca un valor fabricado.
    unlocatedQuantity: null,
    unlocatedAvailableQuantity: null,
    physicalQuantity: null,
    operationalQuantity: item.quantity,
    operationalReservedQuantity: item.reservedQuantity,
    operationalAvailableQuantity: item.availableQuantity,
    requiresRegularization: null,
    // PLACEHOLDER, no fuente autoritativa: /inventory/stock no expone tracking. El tracking real
    // se resuelve on-demand desde el Product detail al abrir el ajuste (AdjustStockGate).
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    availableLots: [],
    availableSerials: [],
    quantity: item.quantity,
    reservedQuantity: item.reservedQuantity,
    availableQuantity: item.availableQuantity,
    minStock: item.minStock,
    reorderPoint: item.reorderPoint ?? undefined,
    status: item.status,
    statusLabel: getInventoryStatusLabel(item.status),
    tracksExpiration: false,
    nextExpirationLabel: "No disponible",
    activeAlerts: [],
    otherBranchStocks: [],
  };
}

/**
 * Fila informativa de un producto SIN stock propio: servicio (NONE) o kit (DERIVED_KIT). No se
 * fabrica existencia: las cantidades quedan en 0 solo como relleno de tipo y la UI no las muestra;
 * el kit expone unicamente su disponibilidad derivada.
 */
function buildNonStockApiRow(
  item: Exclude<InventoryStockListItem, TrackedInventoryStockItem>,
  tenantId: string,
  branchName: string,
  unitById: Map<string, Unit>,
): InventoryProductRow {
  const isKit = item.inventoryMode === "DERIVED_KIT";
  const unitName = isKit ? "Kit" : (unitById.get(item.baseUnitId)?.name ?? item.baseUnitId);
  const derivedAvailable = item.inventoryMode === "DERIVED_KIT" ? item.availableQuantity : 0;
  const statusLabel = !isKit
    ? "No controla inventario"
    : item.displayStatus === "KIT_AVAILABLE"
      ? "Disponible"
      : "Sin disponibilidad";
  return {
    productType: item.productType,
    inventoryMode: item.inventoryMode,
    displayStatus: item.displayStatus,
    productId: item.productId,
    tenantId,
    sku: item.sku,
    productName: item.productName,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    unitId: item.baseUnitId,
    unitName,
    unitAllowsDecimals: false,
    saleUnitId: item.baseUnitId,
    saleUnitName: unitName,
    sellableQuantity: derivedAvailable,
    sellableReservedQuantity: 0,
    sellableAvailableQuantity: derivedAvailable,
    inventoryUnitId: item.baseUnitId,
    inventoryUnitName: unitName,
    inventoryPresentationQuantity: derivedAvailable,
    inventoryPresentationAvailableQuantity: derivedAvailable,
    inventoryToBaseFactor: 1,
    adjustmentUnits: [],
    branchId: item.branchId,
    branchName: branchName || "Sucursal",
    defaultLocationName: isKit ? "Calculado por componentes" : "No aplica",
    locationQuantities: {},
    locationAvailableQuantities: {},
    unlocatedQuantity: 0,
    unlocatedAvailableQuantity: 0,
    tracking: { stock: false, lot: false, expiration: false, serial: false },
    availableLots: [],
    availableSerials: [],
    quantity: derivedAvailable,
    reservedQuantity: 0,
    availableQuantity: derivedAvailable,
    minStock: 0,
    status: null,
    statusLabel,
    tracksExpiration: false,
    nextExpirationLabel: "-",
    activeAlerts: [],
    otherBranchStocks: [],
    isDerivedKit: isKit,
  };
}

function getVisibilityFlags(supportsExpiration: boolean, products: Product[]) {
  const hasExpirationProducts = products.some(isOperationalExpirationProduct);
  return {
    supportsExpiration,
    hasExpirationProducts,
    showExpirationFeatures: supportsExpiration && hasExpirationProducts,
  };
}

function filterRecentTransferResponses(requests: InventoryTransferRequest[]) {
  const threshold = Date.now() - TRANSFER_RESPONSE_ALERT_DAYS * 24 * 60 * 60 * 1000;
  return requests.filter((request) => {
    const timestamp =
      request.approvedAt ?? request.rejectedAt ?? request.reviewedAt ?? request.updatedAt;
    const time = new Date(timestamp).getTime();
    return Number.isFinite(time) && time >= threshold;
  });
}

function buildTransferRequestRows(
  requests: InventoryTransferRequest[],
  context: InventoryTransferRequestRow["context"],
  products: Product[],
  balances: InventoryBalance[],
  maps: InventoryLookupMaps,
): InventoryTransferRequestRow[] {
  return requests
    .flatMap<InventoryTransferRequestRow>((request) => {
      const product = products.find((item) => item.id === request.productId);
      if (!product) return [];
      return [
        {
          id: request.id,
          context,
          productId: request.productId,
          productName: product.name,
          sku: product.sku,
          requestingBranchId: request.requestingBranchId,
          requestingBranchName:
            maps.branches.get(request.requestingBranchId)?.name ?? "Sucursal solicitante",
          sourceBranchId: request.sourceBranchId,
          sourceBranchName:
            maps.branches.get(request.sourceBranchId)?.name ?? "Sucursal proveedora",
          requestedQuantity: request.requestedQuantity,
          availableQuantity: getBranchAvailableQuantity({
            tenantId: request.tenantId,
            productId: request.productId,
            branchId: request.sourceBranchId,
            balances,
            locations: [...maps.locations.values()],
            assignedLocationId:
              maps.assignedLocationIds.get(
                assignedLocationKey(request.sourceBranchId, request.productId),
              ) ?? null,
          }),
          reason: request.reason,
          notes: request.notes,
          status: request.status,
          rejectionReason: request.rejectionReason,
          requestedAt: request.requestedAt,
          approvedAt: request.approvedAt,
          rejectedAt: request.rejectedAt,
          reviewedAt: request.reviewedAt,
        },
      ];
    })
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

function buildApiTransferRequestRows(
  requests: InventoryTransferRequest[],
  context: InventoryTransferRequestRow["context"],
  productById: ReadonlyMap<string, Product>,
  branchNames: ReadonlyMap<string, string>,
  availabilityByProduct: ReadonlyMap<string, number>,
): InventoryTransferRequestRow[] {
  return requests
    .flatMap<InventoryTransferRequestRow>((request) => {
      const product = productById.get(request.productId);
      if (!product) return [];
      return [
        {
          id: request.id,
          context,
          productId: request.productId,
          productName: product.name,
          sku: product.sku,
          requestingBranchId: request.requestingBranchId,
          requestingBranchName:
            branchNames.get(request.requestingBranchId) ?? "Sucursal solicitante",
          sourceBranchId: request.sourceBranchId,
          sourceBranchName: branchNames.get(request.sourceBranchId) ?? "Sucursal proveedora",
          requestedQuantity: request.requestedQuantity,
          ...(context === "received"
            ? { availableQuantity: availabilityByProduct.get(request.productId) ?? 0 }
            : {}),
          reason: request.reason,
          notes: request.notes,
          status: request.status,
          rejectionReason: request.rejectionReason,
          requestedAt: request.requestedAt,
          approvedAt: request.approvedAt,
          rejectedAt: request.rejectedAt,
          reviewedAt: request.reviewedAt,
        },
      ];
    })
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

export function classifyInventoryStatus(
  availableQuantity: number,
  minStock: number,
  reorderPoint?: number | null,
): InventoryStatus {
  if (availableQuantity <= 0) return "out_of_stock";
  if (minStock > 0 && availableQuantity < minStock) return "critical";
  if (reorderPoint != null && availableQuantity <= reorderPoint) return "near_minimum";
  if (reorderPoint == null && minStock > 0 && availableQuantity <= minStock * NEAR_MINIMUM_RATIO) {
    return "near_minimum";
  }
  return "normal";
}

export function getInventoryStatusLabel(status: InventoryStatus) {
  const labels: Record<InventoryStatus, string> = {
    normal: "Normal",
    near_minimum: "Proximo al minimo",
    critical: "Critico",
    out_of_stock: "Sin existencias",
  };
  return labels[status];
}

export function isExpiringSoon(value?: string) {
  if (!value) return false;
  const expirationTime = new Date(value).getTime();
  if (Number.isNaN(expirationTime)) return false;
  const now = Date.now();
  const threshold = now + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
  return expirationTime >= now && expirationTime <= threshold;
}

function isOperationalStockProduct(product: Product): product is ProductWithStock {
  return product.status === ProductStatus.published && product.tracking.stock === true;
}

function isOperationalExpirationProduct(product: Product) {
  return isOperationalStockProduct(product) && product.tracking.expiration === true;
}

function buildRow(
  product: ProductWithStock,
  branchId: string,
  maps: InventoryLookupMaps,
  balances: InventoryBalance[],
  serials: Awaited<ReturnType<RepositoryRegistry["inventory"]["getSerialNumbers"]>>,
  availableQuantity: number,
  conversions: Awaited<ReturnType<RepositoryRegistry["units"]["getConversionsByProductScoped"]>>,
  supplierProducts: Awaited<
    ReturnType<RepositoryRegistry["supplierProducts"]["getByProductForTenant"]>
  >,
): InventoryProductRow {
  const branchBalances = balances.filter(
    (balance) => balance.productId === product.id && balance.branchId === branchId,
  );
  const physicalQuantity = branchBalances.reduce((total, balance) => total + balance.quantity, 0);
  // Existencia operativa: solo la ubicacion asignada y activa (o el saldo heredado sin asignacion).
  const operationalBalances = selectOperationalBalances({
    tenantId: product.tenantId,
    branchId,
    productId: product.id,
    balances: branchBalances,
    locations: [...maps.locations.values()],
    assignedLocationId: maps.assignedLocationIds.get(assignedLocationKey(branchId, product.id)) ?? null,
  });
  const quantity = operationalBalances.reduce((total, balance) => total + balance.quantity, 0);
  const reservedQuantity = operationalBalances.reduce(
    (total, balance) => total + balance.reservedQuantity,
    0,
  );
  const settings = maps.settingsByProduct.get(product.id);
  const minStock = settings?.minStock ?? 0;
  const status = classifyInventoryStatus(availableQuantity, minStock, settings?.reorderPoint);
  const tracksExpiration = product.tracking.expiration;
  const nextExpirationDate = tracksExpiration
    ? getNextExpirationDate(maps.lotsByProduct.get(product.id) ?? [])
    : undefined;
  const defaultLocation = settings?.defaultLocationId
    ? maps.locations.get(settings.defaultLocationId)
    : null;
  const salePresentation = resolveDisplayPresentation(
    product.saleUnitId ?? product.baseUnitId,
    product.baseUnitId,
    conversions,
  );
  const inventoryPresentation = resolveDisplayPresentation(
    product.inventoryUnitId ?? product.baseUnitId,
    product.baseUnitId,
    conversions,
  );
  const saleUnitId = salePresentation.unitId;
  const inventoryUnitId = inventoryPresentation.unitId;
  const saleFactor = salePresentation.factor;
  const inventoryFactor = inventoryPresentation.factor;
  const row: InventoryProductRow = {
    productType: "physical",
    inventoryMode: "TRACKED",
    displayStatus: toPhysicalDisplayStatus(status),
    productId: product.id,
    tenantId: product.tenantId,
    sku: product.sku,
    productName: product.name,
    categoryId: product.categoryId,
    categoryName: maps.categories.get(product.categoryId)?.name ?? "Sin categoria",
    unitId: product.baseUnitId,
    unitName: maps.units.get(product.baseUnitId)?.name ?? "Sin unidad",
    unitAllowsDecimals: maps.units.get(product.baseUnitId)?.allowsDecimals ?? false,
    saleUnitId,
    saleUnitName: maps.units.get(saleUnitId)?.name ?? "Sin unidad",
    sellableQuantity: quantity / saleFactor,
    sellableReservedQuantity: reservedQuantity / saleFactor,
    sellableAvailableQuantity: availableQuantity / saleFactor,
    inventoryUnitId,
    inventoryUnitName: maps.units.get(inventoryUnitId)?.name ?? "Sin unidad",
    inventoryPresentationQuantity: fromBaseQuantity(quantity, {
      targetUnitId: inventoryUnitId,
      baseUnitId: product.baseUnitId,
      conversions,
    }),
    inventoryPresentationAvailableQuantity: fromBaseQuantity(availableQuantity, {
      targetUnitId: inventoryUnitId,
      baseUnitId: product.baseUnitId,
      conversions,
    }),
    inventoryToBaseFactor: inventoryFactor,
    adjustmentUnits: buildAdjustmentUnits(product, conversions, supplierProducts, maps),
    branchId,
    branchName: maps.branches.get(branchId)?.name ?? "Sucursal",
    defaultLocationId: settings?.defaultLocationId,
    defaultLocationName: defaultLocation?.name ?? "Sin ubicacion habitual",
    locationQuantities: buildLocationQuantities(branchBalances),
    locationAvailableQuantities: buildLocationAvailableQuantities(branchBalances),
    unlocatedQuantity: buildUnlocatedQuantity(branchBalances),
    unlocatedAvailableQuantity: buildUnlocatedAvailableQuantity(branchBalances),
    physicalQuantity,
    operationalQuantity: quantity,
    operationalReservedQuantity: reservedQuantity,
    operationalAvailableQuantity: availableQuantity,
    requiresRegularization: Boolean(settings?.defaultLocationId) && physicalQuantity > quantity,
    tracking: product.tracking,
    availableLots: (maps.lotsByProduct.get(product.id) ?? []).filter((lot) => lot.quantity > 0),
    availableSerials: serials
      .filter(
        (serial) =>
          serial.productId === product.id &&
          serial.branchId === branchId &&
          serial.status === SerialStatus.available,
      )
      .map((serial) => ({
        serialNumber: serial.serialNumber,
        lotId: serial.lotId,
        locationId: serial.locationId,
      })),
    quantity,
    reservedQuantity,
    availableQuantity,
    minStock,
    reorderPoint: settings?.reorderPoint,
    status,
    statusLabel: getInventoryStatusLabel(status),
    tracksExpiration,
    nextExpirationDate,
    nextExpirationLabel: formatExpiration(nextExpirationDate),
    activeAlerts: [],
    otherBranchStocks: buildOtherBranchStocks(product.id, branchId, balances, maps),
  };
  row.activeAlerts = buildRowAlerts(row);
  return row;
}

function buildKitRow(
  product: Product,
  components: Array<{ componentProductId: string; quantityPerKit: number }> | undefined,
  availability: Map<string, number>,
  branchId: string,
  maps: InventoryLookupMaps,
): InventoryProductRow {
  const quantity = components?.length
    ? Math.min(
        ...components.map((component) =>
          Math.floor(
            (availability.get(component.componentProductId) ?? 0) / component.quantityPerKit,
          ),
        ),
      )
    : 0;
  const status: InventoryStatus = quantity === 0 ? "out_of_stock" : "normal";
  return {
    productType: "kit",
    inventoryMode: "DERIVED_KIT",
    displayStatus: quantity > 0 ? "KIT_AVAILABLE" : "KIT_UNAVAILABLE",
    productId: product.id,
    tenantId: product.tenantId,
    sku: product.sku,
    productName: product.name,
    categoryId: product.categoryId,
    categoryName: maps.categories.get(product.categoryId)?.name ?? "Sin categoria",
    unitId: product.baseUnitId,
    unitName: "Kit",
    unitAllowsDecimals: false,
    saleUnitId: product.baseUnitId,
    saleUnitName: "Kit",
    sellableQuantity: quantity,
    sellableReservedQuantity: 0,
    sellableAvailableQuantity: quantity,
    inventoryUnitId: product.baseUnitId,
    inventoryUnitName: "Kit",
    inventoryPresentationQuantity: quantity,
    inventoryPresentationAvailableQuantity: quantity,
    inventoryToBaseFactor: 1,
    adjustmentUnits: [],
    branchId,
    branchName: maps.branches.get(branchId)?.name ?? "Sucursal",
    defaultLocationName: "Calculado por componentes",
    locationQuantities: {},
    locationAvailableQuantities: {},
    unlocatedQuantity: 0,
    unlocatedAvailableQuantity: 0,
    tracking: product.tracking,
    availableLots: [],
    availableSerials: [],
    quantity,
    reservedQuantity: 0,
    availableQuantity: quantity,
    minStock: 0,
    status,
    statusLabel: getInventoryStatusLabel(status),
    tracksExpiration: false,
    nextExpirationLabel: "-",
    activeAlerts: [],
    otherBranchStocks: [],
    isDerivedKit: true,
  };
}

function resolveDisplayPresentation(
  unitId: string,
  baseUnitId: string,
  conversions: Parameters<typeof resolveUnitConversion>[0]["conversions"],
) {
  try {
    return {
      unitId,
      factor: resolveUnitConversion({ sourceUnitId: unitId, baseUnitId, conversions }),
    };
  } catch {
    // Read models remain usable, but never label canonical stock with an unconvertible unit.
    return { unitId: baseUnitId, factor: 1 };
  }
}

function buildAdjustmentUnits(
  product: Product,
  conversions: Awaited<ReturnType<RepositoryRegistry["units"]["getConversionsByProductScoped"]>>,
  supplierProducts: Awaited<
    ReturnType<RepositoryRegistry["supplierProducts"]["getByProductForTenant"]>
  >,
  maps: InventoryLookupMaps,
) {
  const candidateUnitIds = new Set([
    product.baseUnitId,
    product.saleUnitId ?? product.baseUnitId,
    product.inventoryUnitId ?? product.baseUnitId,
  ]);
  const supplierFactors = new Map<string, Set<number>>();
  supplierProducts
    .filter((item) => item.active)
    .forEach((item) => {
      const factors = supplierFactors.get(item.purchaseUnitId) ?? new Set<number>();
      factors.add(item.purchaseToBaseFactor);
      supplierFactors.set(item.purchaseUnitId, factors);
    });
  supplierFactors.forEach((factors, unitId) => {
    if (factors.size === 1) candidateUnitIds.add(unitId);
  });

  return [...candidateUnitIds].flatMap((unitId) => {
    const factors = new Set<number>();
    if (unitId === product.baseUnitId) factors.add(1);
    const conversion = conversions.find(
      (item) => item.fromUnitId === unitId && item.toUnitId === product.baseUnitId,
    );
    if (conversion) factors.add(conversion.factor);
    supplierFactors.get(unitId)?.forEach((factor) => factors.add(factor));
    // unitId alone cannot identify which supplier factor was intended.
    if (factors.size !== 1) return [];
    const factor = [...factors][0];
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`Factor de presentacion invalido para ${product.name}.`);
    }
    const unit = maps.units.get(unitId);
    const unitName = unit?.name ?? unitId;
    return [
      {
        unitId,
        unitName,
        unitAllowsDecimals: unit?.allowsDecimals ?? false,
        toBaseFactor: factor,
        label:
          factor === 1
            ? unitName
            : `${unitName} — ${factor} ${maps.units.get(product.baseUnitId)?.name ?? "base"}`,
      },
    ];
  });
}

function buildOtherBranchStocks(
  productId: string,
  currentBranchId: string,
  balances: InventoryBalance[],
  maps: InventoryLookupMaps,
) {
  return [...maps.branches.values()]
    .filter((branch) => branch.id !== currentBranchId)
    .map((branch) => {
      const branchBalances = balances.filter(
        (balance) => balance.productId === productId && balance.branchId === branch.id,
      );
      const quantity = branchBalances.reduce((total, balance) => total + balance.quantity, 0);
      const reservedQuantity = branchBalances.reduce(
        (total, balance) => total + balance.reservedQuantity,
        0,
      );
      const availableQuantity = getBranchAvailableQuantity({
        tenantId: branch.tenantId,
        branchId: branch.id,
        productId,
        balances,
        locations: [...maps.locations.values()],
        assignedLocationId:
          maps.assignedLocationIds.get(assignedLocationKey(branch.id, productId)) ?? null,
      });
      return {
        branchId: branch.id,
        branchName: branch.name,
        quantity,
        reservedQuantity,
        availableQuantity,
      };
    });
}

function buildLocationQuantities(balances: InventoryBalance[]) {
  return balances.reduce<Record<string, number>>((quantities, balance) => {
    if (!balance.locationId) return quantities;
    quantities[balance.locationId] = (quantities[balance.locationId] ?? 0) + balance.quantity;
    return quantities;
  }, {});
}

function buildLocationAvailableQuantities(balances: InventoryBalance[]) {
  return balances.reduce<Record<string, number>>((quantities, balance) => {
    if (!balance.locationId) return quantities;
    quantities[balance.locationId] =
      (quantities[balance.locationId] ?? 0) + balance.quantity - balance.reservedQuantity;
    return quantities;
  }, {});
}

function buildUnlocatedQuantity(balances: InventoryBalance[]) {
  return balances
    .filter((balance) => !balance.locationId)
    .reduce((total, balance) => total + balance.quantity, 0);
}

function buildUnlocatedAvailableQuantity(balances: InventoryBalance[]) {
  return balances
    .filter((balance) => !balance.locationId)
    .reduce((total, balance) => total + balance.quantity - balance.reservedQuantity, 0);
}

function buildRowAlerts(row: InventoryProductRow): InventoryAlert[] {
  const alerts: InventoryAlert[] = [];
  if (row.status === "out_of_stock" || row.status === "critical" || row.status === "near_minimum") {
    alerts.push({
      id: `stock-${row.branchId}-${row.productId}`,
      type: "low_stock",
      productId: row.productId,
      title: row.productName,
      message: getInventoryAvailabilityAlertMessage(row),
      tone: row.status === "near_minimum" ? "warning" : "danger",
      suggestedReorder: getSuggestedReorderQuantity(row),
    });
  }
  if (row.tracksExpiration && isExpiringSoon(row.nextExpirationDate)) {
    alerts.push({
      id: `expiration-${row.branchId}-${row.productId}`,
      type: "expiration",
      productId: row.productId,
      title: row.productName,
      message: `Tiene lote con caducidad proxima: ${row.nextExpirationLabel}.`,
      tone: "warning",
    });
  }
  return alerts;
}

function buildAvailableElsewhereAlerts(
  row: InventoryProductRow,
  balances: InventoryBalance[],
  maps: InventoryLookupMaps,
): InventoryAlert[] {
  if (row.availableQuantity > 0) return [];
  // Solo cuenta la disponibilidad operativa (ubicacion asignada) de la otra sucursal.
  const locations = [...maps.locations.values()];
  const otherBranch = [...maps.branches.values()].find(
    (branch) =>
      branch.id !== row.branchId &&
      getBranchAvailableQuantity({
        tenantId: branch.tenantId,
        branchId: branch.id,
        productId: row.productId,
        balances,
        locations,
        assignedLocationId:
          maps.assignedLocationIds.get(assignedLocationKey(branch.id, row.productId)) ?? null,
      }) > 0,
  );
  if (!otherBranch) return [];
  return [
    {
      id: `elsewhere-${row.branchId}-${row.productId}-${otherBranch.id}`,
      type: "available_elsewhere",
      productId: row.productId,
      title: row.productName,
      message: `Hay disponibilidad en ${maps.branches.get(otherBranch.id)?.name ?? "otra sucursal"}.`,
      tone: "info",
    },
  ];
}

export function getInventoryMinimumDeficit(
  row: Pick<InventoryProductRow, "availableQuantity" | "minStock">,
) {
  return Math.max(0, row.minStock - row.availableQuantity);
}

export function getInventoryAvailabilityAlertMessage(
  row: Pick<
    InventoryProductRow,
    "availableQuantity" | "minStock" | "quantity" | "reservedQuantity" | "status"
  >,
) {
  const detail = `${row.availableQuantity} disponible vs ${row.minStock} minimo; deficit ${getInventoryMinimumDeficit(row)}; existencia fisica ${row.quantity}; reservado ${row.reservedQuantity}`;
  return row.status === "out_of_stock"
    ? `El producto no tiene disponibilidad en esta sucursal (${detail}).`
    : `La disponibilidad esta por debajo o cerca del minimo (${detail}).`;
}

export function getSuggestedReorderQuantity(
  row: Pick<InventoryProductRow, "availableQuantity" | "minStock" | "reorderPoint">,
) {
  const target = row.reorderPoint ?? row.minStock;
  if (target <= row.availableQuantity) return undefined;
  return target - row.availableQuantity;
}

function groupLotsByProduct(lots: StockLot[]) {
  return lots.reduce((map, lot) => {
    const items = map.get(lot.productId) ?? [];
    items.push(lot);
    map.set(lot.productId, items);
    return map;
  }, new Map<string, StockLot[]>());
}

function getNextExpirationDate(lots: StockLot[]) {
  return lots
    .filter((lot) => lot.quantity > 0 && lot.expirationDate)
    .map((lot) => lot.expirationDate as string)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
}

function formatExpiration(value?: string) {
  if (!value) return "Sin caducidad";
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium" }).format(new Date(value));
}
