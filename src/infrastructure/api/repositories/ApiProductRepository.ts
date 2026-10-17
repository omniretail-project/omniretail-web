import { ProductStatus, SalesChannel } from "@/core/enums";
import type { Product } from "@/core/entities";
import type {
  ProductPageItem,
  ProductPageParams,
  ProductRepository,
} from "@/core/repositories/ProductRepository";
import type { PaginatedResult } from "@/core/types/pagination.types";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import { toSameOriginMediaUrl } from "@/infrastructure/api/mediaUrl";
import {
  parseApiProduct,
  parseApiProductPage,
  parseProductCreateRequest,
  parseProductUpdateRequest,
  type ApiProduct,
  type ApiProductList,
} from "@/infrastructure/api/repositories/productApi.schema";
import { normalizeSku } from "@/shared/utils/normalizeSku";

type ProductCreate = Parameters<ProductRepository["create"]>[0];
type ProductUpdate = Parameters<ProductRepository["update"]>[1];
const FETCH_ALL_PAGE_SIZE = 100;
const DEFAULT_SORT: NonNullable<ProductPageParams["sort"]> = "name,asc";
const ALLOWED_SORTS = new Set<NonNullable<ProductPageParams["sort"]>>([
  "name,asc",
  "name,desc",
  "sku,asc",
  "sku,desc",
  "createdAt,asc",
  "createdAt,desc",
]);

export class ApiProductRepository implements ProductRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  /** Compatibilidad temporal para consumidores legacy. ProductsPage usa getPageScoped. */
  async getAll() {
    return this.fetchAllApiPages();
  }

  async getByTenant(_tenantId: string) {
    void _tenantId;
    return this.fetchAllApiPages();
  }

  async getById(id: string) {
    assertApiUuid(id, "productId");
    try {
      return toProduct(parseApiProduct(await backendFetch<unknown>(`/catalog/products/${id}`)));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async getByIdScoped(_tenantId: string, id: string) {
    void _tenantId;
    return this.getById(id);
  }

  /** El backend no expone GET by SKU; se recorren paginas sin inventar un endpoint. */
  async getBySku(sku: string) {
    const normalized = normalizeSku(sku);
    return (await this.fetchAllApiPages()).find((product) => product.sku === normalized) ?? null;
  }

  async getBySkuScoped(_tenantId: string, sku: string) {
    void _tenantId;
    return this.getBySku(sku);
  }

  async getPageScoped(_tenantId: string, params: ProductPageParams) {
    void _tenantId;
    assertPageParams(params);
    const response = parseApiProductPage(
      await backendFetch<unknown>("/catalog/products", {
        query: {
          search: params.search?.trim() || undefined,
          status: params.status,
          productType: params.productType,
          categoryId: params.categoryId,
          channels: params.channels?.length ? params.channels.join(",") : undefined,
          promotion: params.promotion,
          page: params.page,
          size: params.pageSize,
          sort: params.sort ?? DEFAULT_SORT,
        },
      }),
    );
    return mapPage(response);
  }

  async getPublishedForEcommerce(_tenantId: string) {
    void _tenantId;
    return (await this.fetchAllApiPages()).filter(
      (product) =>
        product.status === ProductStatus.published && product.channels.ecommerce,
    );
  }

  async getAvailableForPos() {
    return this.getPublishedForChannel(SalesChannel.pos);
  }

  async getPublishedForChannel(channel: SalesChannel) {
    return (await this.fetchAllApiPages()).filter(
      (product) => product.status === ProductStatus.published && product.channels[channel],
    );
  }

  async create(input: ProductCreate) {
    assertProductReferences(input);
    const product = toProduct(
      parseApiProduct(
        await backendFetch<unknown>("/catalog/products", {
          method: "POST",
          body: parseProductCreateRequest(toCreateRequest(input)),
        }),
      ),
    );
    this.emit(product, "created");
    return product;
  }

  async update(id: string, input: ProductUpdate) {
    assertApiUuid(id, "productId");
    const current = await this.getById(id);
    if (!current) throw productNotFound();
    const next = {
      ...current,
      ...input,
      id: current.id,
      tenantId: current.tenantId,
    } as Product;
    assertProductReferences(next);
    const product = toProduct(
      parseApiProduct(
        await backendFetch<unknown>(`/catalog/products/${id}`, {
          method: "PUT",
          // ProductUpdateRequest deliberadamente excluye salePrice y status.
          body: parseProductUpdateRequest(toUpdateRequest(next)),
        }),
      ),
    );
    this.emit(product, "updated");
    return product;
  }

  async updateScoped(
    _tenantId: string,
    id: string,
    input: Parameters<ProductRepository["updateScoped"]>[2],
  ) {
    void _tenantId;
    return this.update(id, input);
  }

  async updatePrice(id: string, salePrice: number, reason?: string) {
    assertApiUuid(id, "productId");
    const product = toProduct(
      parseApiProduct(
        await backendFetch<unknown>(`/catalog/products/${id}/price`, {
          method: "PUT",
          body: { salePrice, reason: reason?.trim() || undefined },
        }),
      ),
    );
    this.eventBus.emit("product-price.changed", {
      entityId: product.id,
      tenantId: product.tenantId,
      productId: product.id,
      action: "updated",
      newPrice: product.salePrice,
    });
    this.emit(product, "updated");
    return product;
  }

  async archive(id: string) {
    assertApiUuid(id, "productId");
    const current = await this.getById(id);
    if (!current) throw productNotFound();
    await backendFetch<void>(`/catalog/products/${id}`, { method: "DELETE" });
    const product = { ...current, status: ProductStatus.archived };
    this.emit(product, "archived");
    return product;
  }

  async archiveScoped(_tenantId: string, id: string) {
    void _tenantId;
    return this.archive(id);
  }

  async restore(id: string) {
    assertApiUuid(id, "productId");
    const product = toProduct(
      parseApiProduct(
        await backendFetch<unknown>(`/catalog/products/${id}/restore`, { method: "POST" }),
      ),
    );
    this.emit(product, "restored");
    return product;
  }

  async restoreScoped(_tenantId: string, id: string) {
    void _tenantId;
    return this.restore(id);
  }

  private async fetchAllApiPages(): Promise<Product[]> {
    const first = await this.getPageScoped("", {
      page: 1,
      pageSize: FETCH_ALL_PAGE_SIZE,
      sort: DEFAULT_SORT,
    });
    const products = [...first.items];
    for (let page = 2; page <= first.totalPages; page += 1) {
      const next = await this.getPageScoped("", {
        page,
        pageSize: FETCH_ALL_PAGE_SIZE,
        sort: DEFAULT_SORT,
      });
      products.push(...next.items);
    }
    return products;
  }

  private emit(product: Product, action: "created" | "updated" | "archived" | "restored") {
    this.eventBus.emit("product.changed", {
      entityId: product.id,
      productId: product.id,
      tenantId: product.tenantId,
      action,
    });
  }
}

export function toProduct(api: ApiProduct): Product {
  return {
    ...api,
    barcode: api.barcode ?? undefined,
    description: api.description ?? undefined,
    brand: api.brand ?? undefined,
    inventoryUnitId: api.inventoryUnitId ?? undefined,
    saleUnitId: api.saleUnitId ?? undefined,
    salePrice: Number(api.salePrice),
  };
}

export function mapPage(page: PaginatedResult<ApiProductList>): PaginatedResult<ProductPageItem> {
  return {
    ...page,
    items: page.items.map((item) => ({
      ...toProduct(item),
      primaryImageUrl: item.primaryImageUrl
        ? toSameOriginMediaUrl(item.primaryImageUrl)
        : undefined,
    })),
  };
}

function toCreateRequest(product: ProductCreate) {
  return {
    sku: product.sku,
    barcode: product.barcode ?? null,
    name: product.name,
    description: product.description ?? null,
    brand: product.brand ?? null,
    productType: product.productType,
    categoryId: product.categoryId,
    baseUnitId: product.baseUnitId,
    inventoryUnitId: product.inventoryUnitId ?? null,
    saleUnitId: product.saleUnitId ?? null,
    salePrice: product.salePrice,
    status: product.status,
    tracking: product.tracking,
    channels: product.channels,
  };
}

function toUpdateRequest(product: ProductCreate) {
  const { salePrice: _salePrice, status: _status, ...request } = toCreateRequest(product);
  void _salePrice;
  void _status;
  return request;
}

function assertProductReferences(product: ProductCreate) {
  assertApiUuid(product.categoryId, "categoryId");
  assertApiUuid(product.baseUnitId, "baseUnitId");
  assertOptionalApiUuid(product.inventoryUnitId, "inventoryUnitId");
  assertOptionalApiUuid(product.saleUnitId, "saleUnitId");
  if (!product.sku.trim() || !product.name.trim() || !Number.isFinite(product.salePrice)) {
    throw new BackendRequestError(
      "Los datos basicos del producto no son validos.",
      400,
      "INVALID_PRODUCT_PAYLOAD",
    );
  }
}

function assertPageParams(params: ProductPageParams) {
  if (!Number.isSafeInteger(params.page) || params.page < 1)
    throw new BackendRequestError("page debe comenzar en 1.", 400, "INVALID_PAGE");
  if (!Number.isSafeInteger(params.pageSize) || params.pageSize < 1)
    throw new BackendRequestError("pageSize debe ser positivo.", 400, "INVALID_PAGE_SIZE");
  if (params.sort && !ALLOWED_SORTS.has(params.sort))
    throw new BackendRequestError("Ordenamiento no permitido.", 400, "INVALID_SORT");
  assertOptionalApiUuid(params.categoryId, "categoryId");
}

function productNotFound() {
  return new BackendRequestError("Producto no encontrado.", 404, "PRODUCT_NOT_FOUND");
}
