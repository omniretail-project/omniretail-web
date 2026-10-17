import type { InventoryBalance } from "@/core/entities";
import type {
  GetProductBalancesOptions,
  GetInventoryKitAvailabilityInput,
  GetInventoryStockBatchInput,
  GetOtherBranchesAvailabilityInput,
  InventoryAlertPageParams,
  InventoryRepository,
  InventoryStockPageParams,
} from "@/core/repositories";
import type { DataEventPayload } from "@/core/types/events.types";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import {
  parseApiInventoryBalancePage,
  parseApiInventoryKitAvailability,
  parseApiInventoryStockBatch,
  parseApiOtherBranchesAvailability,
  parseApiInventoryAlertPage,
  parseApiInventoryStockPage,
} from "@/infrastructure/api/repositories/inventoryStockApi.schema";

// El backend filtrado admite hasta 2,000 filas. En el caso normal (un producto con pocas
// ubicaciones) esto convierte la lectura en una unica peticion.
const BALANCE_PAGE_SIZE = 2_000;
// Compatibilidad acotada con versiones que ignoran productId. Nunca se escanea una sucursal grande:
// hasta tres paginas se completan en paralelo; por encima de ese limite se falla cerrado.
const MAX_COMPATIBILITY_BALANCE_PAGES = 3;
const PRODUCT_BALANCE_CACHE_TTL_MS = 1_000;
const DEFAULT_STOCK_SORT = "productName,asc" as const;
const ALLOWED_STOCK_SORTS = new Set<NonNullable<InventoryStockPageParams["sort"]>>([
  "productName,asc",
  "productName,desc",
  "sku,asc",
  "sku,desc",
  "categoryName,asc",
  "categoryName,desc",
  "availableQuantity,asc",
  "availableQuantity,desc",
  "status,asc",
  "status,desc",
]);

export class ApiInventoryStockRepository {
  private readonly productBalanceValues = new Map<
    string,
    { value: InventoryBalance[]; expiresAt: number }
  >();
  private readonly productBalanceLoads = new Map<string, Promise<InventoryBalance[]>>();

  constructor(eventBus?: Pick<DataEventBus, "subscribe">) {
    eventBus?.subscribe("stock.changed", (payload) => this.invalidateProductBalances(payload));
  }

  withInventoryDelegate(delegate: InventoryRepository): InventoryRepository {
    const getStockPage = this.getStockPage.bind(this);
    const getInventoryAlertPage = this.getInventoryAlertPage.bind(this);
    const getOtherBranchesAvailability = this.getOtherBranchesAvailability.bind(this);
    const getKitAvailability = this.getKitAvailability.bind(this);
    const getStockBatch = this.getStockBatch.bind(this);
    const getProductBalances = this.getProductBalances.bind(this);
    return new Proxy(delegate, {
      get: (target, property) => {
        if (property === "getProductBalances") return getProductBalances;
        if (property === "getKitAvailability") return getKitAvailability;
        if (property === "getStockBatch") return getStockBatch;
        if (property === "getStockPage") return getStockPage;
        if (property === "getInventoryAlertPage") return getInventoryAlertPage;
        if (property === "getOtherBranchesAvailability") return getOtherBranchesAvailability;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async getStockPage(params: InventoryStockPageParams) {
    assertPage(params.page, params.pageSize);
    assertApiUuid(params.branchId, "branchId");
    assertOptionalApiUuid(params.categoryId, "categoryId");
    if (params.sort && !ALLOWED_STOCK_SORTS.has(params.sort)) {
      throw new BackendRequestError("Ordenamiento de stock no permitido.", 400, "INVALID_SORT");
    }
    if (params.lowStock && params.status) {
      throw new BackendRequestError(
        "lowStock no puede combinarse con un estado explicito.",
        400,
        "INVENTORY_STOCK_FILTERS_INCOMPATIBLE",
      );
    }
    return parseApiInventoryStockPage(
      await backendFetch<unknown>("/inventory/stock", {
        query: {
          branchId: params.branchId,
          search: params.search?.trim() || undefined,
          categoryId: params.categoryId,
          status: params.status,
          lowStock: params.lowStock ? true : undefined,
          productTypes: params.productTypes?.length ? params.productTypes.join(",") : undefined,
          page: params.page,
          size: params.pageSize,
          sort: params.sort ?? DEFAULT_STOCK_SORT,
        },
      }),
    );
  }

  async getStockBatch(input: GetInventoryStockBatchInput) {
    assertApiUuid(input.branchId, "branchId");
    input.productIds.forEach((productId) => assertApiUuid(productId, "productId"));
    return parseApiInventoryStockBatch(
      await backendFetch<unknown>("/inventory/stock/batch", {
        method: "POST",
        body: { branchId: input.branchId, productIds: input.productIds },
      }),
    );
  }

  /**
   * Balances REALES (uno por ubicacion, incluido el balance sin ubicacion) de un producto en una
   * sucursal. Se envia `productId`: el backend nuevo filtra en servidor; versiones anteriores ignoran
   * el parametro y siguen siendo compatibles porque se pagina/filtra de forma defensiva. Si no se
   * puede garantizar la lectura completa, falla en vez de devolver una lista parcial.
   */
  async getProductBalances(
    productId: string,
    branchId: string,
    tenantId: string,
    options: GetProductBalancesOptions = {},
  ): Promise<InventoryBalance[]> {
    assertApiUuid(productId, "productId");
    assertApiUuid(branchId, "branchId");
    assertApiUuid(tenantId, "tenantId");
    const key = productBalanceKey(tenantId, branchId, productId);
    if (options.fresh) {
      this.productBalanceValues.delete(key);
      this.productBalanceLoads.delete(key);
      return this.loadProductBalances(productId, branchId, tenantId);
    }

    const cached = this.productBalanceValues.get(key);
    if (cached && cached.expiresAt > Date.now()) return cloneBalances(cached.value);
    if (cached) this.productBalanceValues.delete(key);

    const pending = this.productBalanceLoads.get(key);
    if (pending) return pending.then(cloneBalances);

    const request = this.loadProductBalances(productId, branchId, tenantId)
      .then((balances) => {
        // Una invalidacion durante el vuelo elimina la key: ese resultado ya no se cachea.
        if (this.productBalanceLoads.get(key) === request) {
          this.productBalanceValues.set(key, {
            value: cloneBalances(balances),
            expiresAt: Date.now() + PRODUCT_BALANCE_CACHE_TTL_MS,
          });
        }
        return balances;
      })
      .finally(() => {
        if (this.productBalanceLoads.get(key) === request) this.productBalanceLoads.delete(key);
      });
    this.productBalanceLoads.set(key, request);
    return request.then(cloneBalances);
  }

  private async loadProductBalances(
    productId: string,
    branchId: string,
    tenantId: string,
  ): Promise<InventoryBalance[]> {
    const first = await this.getBalancePage(productId, branchId, 1);
    assertBalancePage(first, 1, tenantId, branchId);
    if (first.totalPages > MAX_COMPATIBILITY_BALANCE_PAGES) throw incompleteBalances();

    const remaining = await Promise.all(
      Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
        this.getBalancePage(productId, branchId, index + 2),
      ),
    );
    const pages = [first, ...remaining];
    pages.forEach((page, index) => {
      assertBalancePage(page, index + 1, tenantId, branchId);
      if (
        page.totalItems !== first.totalItems ||
        page.totalPages !== first.totalPages ||
        page.pageSize !== first.pageSize
      ) {
        throw incompleteBalances();
      }
    });
    const items = pages.flatMap((page) => page.items);
    if (
      items.length !== first.totalItems ||
      new Set(items.map((item) => item.id)).size !== items.length
    ) {
      throw incompleteBalances();
    }
    const target = productId.toLowerCase();
    return items
      .filter((item) => item.productId.toLowerCase() === target)
      .map((item) => ({
        id: item.id,
        tenantId: item.tenantId,
        branchId: item.branchId,
        productId: item.productId,
        ...(item.locationId ? { locationId: item.locationId } : {}),
        quantity: item.quantity,
        reservedQuantity: item.reservedQuantity,
        updatedAt: item.updatedAt ?? "",
      }));
  }

  private async getBalancePage(productId: string, branchId: string, page: number) {
    return parseApiInventoryBalancePage(
      await backendFetch<unknown>("/inventory/balances", {
        query: { branchId, productId, page, size: BALANCE_PAGE_SIZE },
      }),
    );
  }

  private invalidateProductBalances(payload: DataEventPayload) {
    for (const key of new Set([
      ...this.productBalanceValues.keys(),
      ...this.productBalanceLoads.keys(),
    ])) {
      const [tenantId, branchId, productId] = key.split(":");
      if (payload.tenantId && payload.tenantId.toLowerCase() !== tenantId) continue;
      if (payload.branchId && payload.branchId.toLowerCase() !== branchId) continue;
      if (payload.productId && payload.productId.toLowerCase() !== productId) continue;
      this.productBalanceValues.delete(key);
      this.productBalanceLoads.delete(key);
    }
  }

  async getKitAvailability(input: GetInventoryKitAvailabilityInput) {
    assertApiUuid(input.kitProductId, "kitProductId");
    assertApiUuid(input.branchId, "branchId");
    return parseApiInventoryKitAvailability(
      await backendFetch<unknown>(`/inventory/stock/kits/${input.kitProductId}/availability`, {
        query: { branchId: input.branchId },
      }),
    );
  }

  async getOtherBranchesAvailability(input: GetOtherBranchesAvailabilityInput) {
    assertApiUuid(input.productId, "productId");
    assertApiUuid(input.branchId, "branchId");
    return parseApiOtherBranchesAvailability(
      await backendFetch<unknown>("/inventory/stock/branches", {
        query: { productId: input.productId, branchId: input.branchId },
      }),
    );
  }

  async getInventoryAlertPage(params: InventoryAlertPageParams) {
    assertPage(params.page, params.pageSize);
    assertApiUuid(params.branchId, "branchId");
    return parseApiInventoryAlertPage(
      await backendFetch<unknown>("/inventory/alerts", {
        query: {
          branchId: params.branchId,
          status: params.status,
          page: params.page,
          size: params.pageSize,
        },
      }),
    );
  }
}

function incompleteBalances() {
  return new BackendRequestError(
    "No se pudo determinar el saldo por ubicacion del producto.",
    502,
    "INVENTORY_BALANCES_INCOMPLETE",
  );
}

function assertBalancePage(
  page: ReturnType<typeof parseApiInventoryBalancePage>,
  expectedPage: number,
  tenantId: string,
  branchId: string,
) {
  if (
    page.page !== expectedPage ||
    (page.totalPages === 0 ? page.totalItems !== 0 : page.page > page.totalPages)
  ) {
    throw incompleteBalances();
  }
  if (page.page < page.totalPages && page.items.length === 0) throw incompleteBalances();
  if (
    page.items.some(
      (item) =>
        item.tenantId.toLowerCase() !== tenantId.toLowerCase() ||
        item.branchId.toLowerCase() !== branchId.toLowerCase(),
    )
  ) {
    throw new BackendRequestError(
      "El backend devolvio balances fuera del tenant o sucursal solicitados.",
      502,
      "INVENTORY_BALANCES_SCOPE_MISMATCH",
    );
  }
}

function productBalanceKey(tenantId: string, branchId: string, productId: string) {
  return `${tenantId.toLowerCase()}:${branchId.toLowerCase()}:${productId.toLowerCase()}`;
}

function cloneBalances(balances: InventoryBalance[]) {
  return balances.map((balance) => ({ ...balance }));
}

function assertPage(page: number, pageSize: number) {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new BackendRequestError("page debe comenzar en 1.", 400, "INVALID_PAGE");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BackendRequestError("pageSize debe estar entre 1 y 100.", 400, "INVALID_PAGE_SIZE");
  }
}
