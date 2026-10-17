import type {
  InventoryMovementPageParams,
  InventoryRepository,
} from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import { assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import { parseApiInventoryMovementPage } from "@/infrastructure/api/repositories/inventoryMovementApi.schema";

const DEFAULT_SORT = "createdAt,desc" as const;
const ALLOWED_SORTS = new Set<NonNullable<InventoryMovementPageParams["sort"]>>([
  "createdAt,asc",
  "createdAt,desc",
  "quantity,asc",
  "quantity,desc",
  "type,asc",
  "type,desc",
  "productId,asc",
  "productId,desc",
  "branchId,asc",
  "branchId,desc",
]);

export class ApiInventoryMovementRepository {
  withInventoryDelegate(delegate: InventoryRepository): InventoryRepository {
    const getMovementPage = this.getMovementPage.bind(this);
    return new Proxy(delegate, {
      get: (target, property) => {
        if (property === "getMovementPage") return getMovementPage;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async getMovementPage(params: InventoryMovementPageParams) {
    assertParams(params);
    return parseApiInventoryMovementPage(
      await backendFetch<unknown>("/inventory/movements", {
        query: {
          branchId: params.branchId,
          productId: params.productId,
          type: params.type,
          from: params.from,
          to: params.to,
          search: params.search?.trim() || undefined,
          displayType: params.displayType,
          page: params.page,
          size: params.pageSize,
          sort: params.sort ?? DEFAULT_SORT,
        },
      }),
    );
  }
}

function assertParams(params: InventoryMovementPageParams) {
  if (!Number.isSafeInteger(params.page) || params.page < 1) {
    throw new BackendRequestError("page debe comenzar en 1.", 400, "INVALID_PAGE");
  }
  if (!Number.isSafeInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 100) {
    throw new BackendRequestError(
      "pageSize debe estar entre 1 y 100.",
      400,
      "INVALID_PAGE_SIZE",
    );
  }
  if (params.sort && !ALLOWED_SORTS.has(params.sort)) {
    throw new BackendRequestError("Ordenamiento no permitido.", 400, "INVALID_SORT");
  }
  assertOptionalApiUuid(params.branchId, "branchId");
  assertOptionalApiUuid(params.productId, "productId");
  if (params.from && Number.isNaN(Date.parse(params.from))) {
    throw new BackendRequestError("from debe ser una fecha valida.", 400, "INVALID_FROM");
  }
  if (params.to && Number.isNaN(Date.parse(params.to))) {
    throw new BackendRequestError("to debe ser una fecha valida.", 400, "INVALID_TO");
  }
}
