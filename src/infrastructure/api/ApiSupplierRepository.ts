import type { Supplier, SupplierProduct } from "@/core/entities";
import type {
  OperationalSupplierIncident,
  OperationalSupplierIncidentPageParams,
  OperationalSupplierProduct,
  OperationalSupplierProductPageParams,
  OperationalSupplier,
  OperationalSupplierDetail,
  OperationalSupplierPageParams,
  OperationalSupplierSummary,
  SupplierRepository,
} from "@/core/repositories";
import type { PaginatedResult } from "@/core/types";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  type ApiSupplier,
  parseOperationalSupplierIncidentPage,
  parseOperationalSupplierProductPage,
  parseOperationalSupplierDetail,
  parseOperationalSupplierPage,
  parseOperationalSuppliers,
  toSupplier,
  toSupplierRequest,
} from "@/infrastructure/api/apiSupplierMapper";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const BASE_PATH = "/administration/suppliers";
/** Tamaño de pagina al recorrer el listado completo. */
const PAGE_SIZE = 100;

type SupplierInput = Omit<Supplier, "id" | "createdAt" | "updatedAt" | "leadTimeDays">;

/**
 * SupplierRepository de modo API. Las operaciones administrativas conservan
 * `/administration/suppliers`; la seleccion operativa de Purchasing usa su endpoint dedicado.
 */
export class ApiSupplierRepository implements SupplierRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getAll(): Promise<Supplier[]> {
    const suppliers: Supplier[] = [];
    for (let page = 1; ; page++) {
      const result = await backendFetch<PaginatedResult<ApiSupplier>>(BASE_PATH, {
        query: { page, size: PAGE_SIZE },
      });
      suppliers.push(...result.items.map(toSupplier));
      if (page >= result.totalPages) return suppliers;
    }
  }

  async getById(id: string): Promise<Supplier | null> {
    if (!isApiUuid(id)) return null;
    try {
      return toSupplier(await backendFetch<ApiSupplier>(`${BASE_PATH}/${id}`));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async getActive(): Promise<Supplier[]> {
    const suppliers = await backendFetch<ApiSupplier[]>(`${BASE_PATH}/active`);
    return suppliers.map(toSupplier);
  }

  async getActiveByTenant(tenantId: string): Promise<OperationalSupplier[]> {
    void tenantId;
    return parseOperationalSuppliers(
      await backendFetch<unknown>("/purchasing/suppliers/active"),
    );
  }

  /** Listado informativo de Compras: paginado y filtrado en servidor, page base 1. */
  async getOperationalPage(
    params: OperationalSupplierPageParams,
  ): Promise<PaginatedResult<OperationalSupplierSummary>> {
    return parseOperationalSupplierPage(
      await backendFetch<unknown>("/purchasing/suppliers", {
        query: {
          status: params.status,
          search: params.search?.trim() || undefined,
          page: params.page,
          size: params.pageSize,
        },
      }),
    );
  }

  async getOperationalProducts(
    supplierId: string,
    params: OperationalSupplierProductPageParams,
  ): Promise<PaginatedResult<OperationalSupplierProduct>> {
    assertSupplierId(supplierId);
    return parseOperationalSupplierProductPage(
      await backendFetch<unknown>(`/purchasing/suppliers/${supplierId}/products`, {
        query: {
          active: params.active,
          search: params.search?.trim() || undefined,
          page: params.page,
          size: params.pageSize,
        },
      }),
    );
  }

  async getOperationalIncidents(
    supplierId: string,
    params: OperationalSupplierIncidentPageParams,
  ): Promise<PaginatedResult<OperationalSupplierIncident>> {
    assertSupplierId(supplierId);
    return parseOperationalSupplierIncidentPage(
      await backendFetch<unknown>(`/purchasing/suppliers/${supplierId}/incidents`, {
        query: {
          status: params.status,
          branchId: params.branchId,
          page: params.page,
          size: params.pageSize,
        },
      }),
    );
  }

  async getOperationalById(id: string): Promise<OperationalSupplierDetail | null> {
    if (!isApiUuid(id)) return null;
    try {
      return parseOperationalSupplierDetail(
        await backendFetch<unknown>(`/purchasing/suppliers/${id}`),
      );
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async listByTenant(tenantId: string): Promise<Supplier[]> {
    return (await this.getAll()).filter((supplier) => supplier.tenantId === tenantId);
  }

  /**
   * Las relaciones proveedor-producto viven en `/purchasing/supplier-products` (modulo de compras,
   * aun no migrado); el backend administrativo no las expone, asi que se devuelve vacio.
   */
  async getProductsBySupplier(): Promise<SupplierProduct[]> {
    return [];
  }

  async create(input: SupplierInput): Promise<Supplier> {
    const created = toSupplier(
      await backendFetch<ApiSupplier>(BASE_PATH, {
        method: "POST",
        body: toSupplierRequest(input),
      }),
    );
    this.emitChanged(created, "created");
    return created;
  }

  async update(id: string, input: Partial<SupplierInput>): Promise<Supplier> {
    const current = await this.require(id);
    const updated = toSupplier(
      await backendFetch<ApiSupplier>(`${BASE_PATH}/${id}`, {
        method: "PUT",
        body: toSupplierRequest({ ...current, ...input }),
      }),
    );
    this.emitChanged(updated, updated.status === "archived" ? "archived" : "updated");
    return updated;
  }

  /** El DELETE del backend archiva (204) y no devuelve el proveedor: se relee para el contrato. */
  async archive(id: string): Promise<Supplier> {
    await this.require(id);
    await backendFetch<void>(`${BASE_PATH}/${id}`, { method: "DELETE" });
    const archived = await this.require(id);
    this.emitChanged(archived, "archived");
    return archived;
  }

  private async require(id: string): Promise<Supplier> {
    const supplier = await this.getById(id);
    if (!supplier) throw new Error("Proveedor no encontrado.");
    return supplier;
  }

  private emitChanged(supplier: Supplier, action: "created" | "updated" | "archived"): void {
    this.eventBus.emit("supplier.changed", {
      entityId: supplier.id,
      tenantId: supplier.tenantId,
      action,
    });
  }
}

function assertSupplierId(supplierId: string) {
  if (!isApiUuid(supplierId)) {
    throw new BackendRequestError("Proveedor invalido.", 400, "INVALID_SUPPLIER_ID");
  }
}
