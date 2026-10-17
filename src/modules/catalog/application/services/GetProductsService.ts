import type { Category, Promotion } from "@/core/entities";
import {
  CategoryStatus,
  ProductStatus,
  ProductType,
  PromotionStatus,
  PromotionType,
  SalesChannel,
} from "@/core/enums";
import { getBranchAvailableQuantity } from "@/core/inventory/stockAvailability";
import { getProductMediaSource, selectPrimaryProductMedia } from "@/core/media/catalogImage";
import { calculateEffectivePrice } from "@/core/pricing";
import type { ProductPageParams } from "@/core/repositories/ProductRepository";
import type { PaginatedResult } from "@/core/types/pagination.types";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ensureCanReadProducts,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";
import type {
  ProductFiltersState,
  ProductListItem,
} from "@/modules/catalog/types/catalog.types";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import {
  REFERENCE_DATA_TTL_MS,
  getReferenceDataCache,
  referenceDataKeys,
  referenceDataPrefixes,
} from "@/shared/utils/requestCache";

const MOCK_FETCH_PAGE_SIZE = 100;

export interface GetProductsParams extends ProductPageParams {
  branchId?: string;
  filters: ProductFiltersState;
}

/** Pagina de productos + las categorias ACTIVAS del tenant (ya cargadas para resolver nombres). */
export type GetProductsResult = PaginatedResult<ProductListItem> & {
  categories: Category[];
};

export class GetProductsService {
  private readonly promotionsPromisesByTenant = new Map<
    string,
    ReturnType<RepositoryRegistry["promotions"]["getActiveByTenant"]>
  >();

  private readonly referenceCache;

  constructor(private readonly repositories: RepositoryRegistry) {
    this.referenceCache = getReferenceDataCache(repositories);
  }

  /**
   * Descarta las promociones activas cacheadas para que el siguiente `execute` las vuelva a pedir.
   * Con `tenantId` solo invalida ese tenant; sin el, invalida todos (payload de evento sin tenant).
   */
  invalidatePromotions(tenantId?: string) {
    if (tenantId) {
      this.promotionsPromisesByTenant.delete(tenantId);
      return;
    }
    this.promotionsPromisesByTenant.clear();
  }

  /** Descarta las categorias cacheadas (category.changed): el siguiente `execute` las vuelve a pedir. */
  invalidateCategories(tenantId?: string) {
    if (tenantId) {
      this.referenceCache.invalidate(referenceDataKeys.categories(tenantId));
      return;
    }
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.categories);
  }

  async execute(params: GetProductsParams): Promise<GetProductsResult> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanReadProducts(permissions);

    if (this.repositories.productDataSource === "api") {
      return this.getApiPage(tenantId, params, {
        canReadPromotions: permissions.includes("catalog.promotions.read"),
        canReadCategories:
          permissions.includes("catalog.categories.read") ||
          permissions.includes("catalog.categories.manage"),
        canReadUnits:
          permissions.includes("catalog.units.read") ||
          permissions.includes("catalog.units.manage"),
      });
    }
    return this.getMockPage(tenantId, params);
  }

  /**
   * Categorias, unidades y promociones son datos auxiliares: sin el permiso correspondiente el
   * backend responde 403 y tumbaria tambien el listado de productos (p. ej. rol Inventario, que
   * solo tiene permisos de producto). Sin permiso se usan listas vacias y los nombres caen a
   * "Sin categoria"/"Sin unidad".
   */
  private async getApiPage(
    tenantId: string,
    params: GetProductsParams,
    access: { canReadPromotions: boolean; canReadCategories: boolean; canReadUnits: boolean },
  ) {
    const { canReadPromotions, canReadCategories, canReadUnits } = access;
    const [page, categories, units, promotions] = await Promise.all([
      this.repositories.products.getPageScoped(tenantId, toApiPageParams(params)),
      canReadCategories
        ? this.referenceCache.getOrLoad(
            referenceDataKeys.categories(tenantId),
            REFERENCE_DATA_TTL_MS,
            () => this.repositories.categories.getByTenant(tenantId),
          )
        : Promise.resolve([]),
      canReadUnits
        ? this.referenceCache.getOrLoad(
            referenceDataKeys.units(tenantId),
            REFERENCE_DATA_TTL_MS,
            () => this.repositories.units.getByTenant(tenantId),
          )
        : Promise.resolve([]),
      canReadPromotions
        ? this.getOrCreateTenantPromise(this.promotionsPromisesByTenant, tenantId, () =>
            this.repositories.promotions.getActiveByTenant(tenantId),
          )
        : Promise.resolve([]),
    ]);
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
    const now = new Date();

    return {
      ...page,
      categories: toActiveCategories(categories),
      items: page.items.map((product): ProductListItem => {
        const activePromotion =
          product.status === ProductStatus.published
            ? getCurrentPromotion(product.id, product.tenantId, promotions, now)
            : undefined;
        const effectivePrice = activePromotion
          ? calculateEffectivePrice(product.salePrice, activePromotion).effectivePrice
          : product.salePrice;

        return {
          id: product.id,
          tenantId: product.tenantId,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          brand: product.brand,
          categoryName: categoryNames.get(product.categoryId) ?? "Sin categoria",
          categoryId: product.categoryId,
          baseUnitName: unitNames.get(product.baseUnitId) ?? "Sin unidad",
          baseUnitId: product.baseUnitId,
          productType: product.productType,
          salePrice: product.salePrice,
          channels: product.channels,
          hasActivePromotion: Boolean(activePromotion),
          activePromotion: activePromotion
            ? {
                id: activePromotion.id,
                label: formatPromotionLabel(activePromotion),
                effectivePrice,
              }
            : undefined,
          status: product.status,
          tracking: product.tracking,
          imageSource: product.primaryImageUrl
            ? { kind: "url", src: product.primaryImageUrl }
            : undefined,
          availableQuantity: undefined,
        };
      }),
    };
  }

  private getOrCreateTenantPromise<T>(
    cache: Map<string, Promise<T>>,
    tenantId: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = cache.get(tenantId);
    if (cached) return cached;

    const pending = load();
    cache.set(tenantId, pending);
    void pending.catch(() => {
      if (cache.get(tenantId) === pending) cache.delete(tenantId);
    });
    return pending;
  }

  private async getMockPage(tenantId: string, params: GetProductsParams) {
    const products = await this.getAllMockProducts(tenantId, params.sort);
    const [categories, units, promotions] = await Promise.all([
      this.repositories.categories.getByTenant(tenantId),
      this.repositories.units.getByTenant(tenantId),
      this.repositories.promotions.getActiveByTenant(tenantId),
    ]);
    const locations = params.branchId
      ? await this.repositories.inventory.getLocations(params.branchId)
      : [];
    const mediaEntries = await Promise.all(
      products.map(
        async (product) =>
          [product.id, await this.repositories.productMedia.getByProduct(product.id)] as const,
      ),
    );
    const mediaByProduct = new Map(mediaEntries);
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
    const now = new Date();

    const enriched = await Promise.all(
      products.map(async (product): Promise<ProductListItem> => {
        const activePromotion =
          product.status === ProductStatus.published
            ? getCurrentPromotion(product.id, product.tenantId, promotions, now)
            : undefined;
        const effectivePrice = activePromotion
          ? calculateEffectivePrice(product.salePrice, activePromotion).effectivePrice
          : product.salePrice;
        const balances =
          params.branchId &&
          product.productType === ProductType.physical &&
          product.tracking.stock
            ? await this.repositories.inventory.getBalanceByProduct(product.id, params.branchId)
            : [];

        return {
          id: product.id,
          tenantId: product.tenantId,
          imageSource: getPrimaryImageSource(
            mediaByProduct.get(product.id) ?? [],
            product.tenantId,
          ),
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          brand: product.brand,
          categoryName: categoryNames.get(product.categoryId) ?? "Sin categoria",
          categoryId: product.categoryId,
          baseUnitName: unitNames.get(product.baseUnitId) ?? "Sin unidad",
          baseUnitId: product.baseUnitId,
          productType: product.productType,
          salePrice: product.salePrice,
          channels: product.channels,
          hasActivePromotion: Boolean(activePromotion),
          activePromotion: activePromotion
            ? {
                id: activePromotion.id,
                label: formatPromotionLabel(activePromotion),
                effectivePrice,
              }
            : undefined,
          status: product.status,
          tracking: product.tracking,
          availableQuantity:
            params.branchId &&
            product.productType === ProductType.physical &&
            product.tracking.stock
              ? getBranchAvailableQuantity({
                  tenantId,
                  branchId: params.branchId,
                  productId: product.id,
                  balances,
                  locations,
                })
              : undefined,
        };
      }),
    );

    const filtered = filterProducts(enriched, params.filters);
    const totalPages = Math.ceil(filtered.length / params.pageSize);
    const page = Math.min(params.page, Math.max(1, totalPages));
    const start = (page - 1) * params.pageSize;
    return {
      categories: toActiveCategories(categories),
      items: filtered.slice(start, start + params.pageSize),
      page,
      pageSize: params.pageSize,
      totalItems: filtered.length,
      totalPages,
    };
  }

  private async getAllMockProducts(
    tenantId: string,
    sort: ProductPageParams["sort"],
  ) {
    const first = await this.repositories.products.getPageScoped(tenantId, {
      page: 1,
      pageSize: MOCK_FETCH_PAGE_SIZE,
      sort,
    });
    const products = [...first.items];
    for (let page = 2; page <= first.totalPages; page += 1) {
      const next = await this.repositories.products.getPageScoped(tenantId, {
        page,
        pageSize: MOCK_FETCH_PAGE_SIZE,
        sort,
      });
      products.push(...next.items);
    }
    return products;
  }
}

/** Solo categorias activas, en el orden en que las entrega el repository (alimenta los filtros). */
function toActiveCategories(categories: Category[]): Category[] {
  return categories.filter((category) => category.status === CategoryStatus.active);
}

function toApiPageParams(params: GetProductsParams): ProductPageParams {
  const { filters } = params;
  return {
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    search: filters.search.trim() || undefined,
    status: filters.status === "all" ? undefined : filters.status,
    productType: filters.productType === "all" ? undefined : filters.productType,
    categoryId: filters.categoryId === "all" ? undefined : filters.categoryId,
    channels: filters.channels.length
      ? filters.channels.map((channel) => SalesChannel[channel])
      : undefined,
    promotion: filters.promotion === "all" ? undefined : filters.promotion,
  };
}

function filterProducts(products: ProductListItem[], filters: ProductFiltersState) {
  const query = filters.search.trim().toLowerCase();
  return products.filter((product) => {
    const matchesSearch =
      !query ||
      [product.name, product.sku, product.barcode, product.brand]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));
    const matchesStatus = filters.status === "all" || product.status === filters.status;
    const matchesType =
      filters.productType === "all" || product.productType === filters.productType;
    const matchesCategory =
      filters.categoryId === "all" || product.categoryId === filters.categoryId;
    const matchesChannel =
      filters.channels.length === 0 ||
      filters.channels.some((channel) => product.channels[channel]);
    const matchesPromotion =
      filters.promotion === "all" ||
      (filters.promotion === "with" && product.hasActivePromotion) ||
      (filters.promotion === "without" && !product.hasActivePromotion);
    return (
      matchesSearch &&
      matchesStatus &&
      matchesType &&
      matchesCategory &&
      matchesChannel &&
      matchesPromotion
    );
  });
}

function getCurrentPromotion(
  productId: string,
  tenantId: string,
  promotions: Promotion[],
  now: Date,
) {
  const timestamp = now.getTime();
  return promotions.find((promotion) => {
    const startsAt = new Date(promotion.startAt).getTime();
    const endsAt = promotion.endAt ? new Date(promotion.endAt).getTime() : Number.POSITIVE_INFINITY;
    return (
      promotion.productIds.includes(productId) &&
      promotion.tenantId === tenantId &&
      promotion.status === PromotionStatus.active &&
      startsAt <= timestamp &&
      timestamp <= endsAt
    );
  });
}

function formatPromotionLabel(promotion: Promotion) {
  const value =
    promotion.type === PromotionType.percentage
      ? `${promotion.value}% descuento`
      : promotion.type === PromotionType.fixedDiscount
        ? `${formatCurrency(promotion.value)} descuento`
        : `Precio ${formatCurrency(promotion.value)}`;
  return `${value} - Activa`;
}

function getPrimaryImageSource(
  media: Awaited<ReturnType<RepositoryRegistry["productMedia"]["getByProduct"]>>,
  tenantId: string,
) {
  const primary = selectPrimaryProductMedia(media.filter((item) => item.tenantId === tenantId));
  return primary ? (getProductMediaSource(primary) ?? undefined) : undefined;
}
