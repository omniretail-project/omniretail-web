import type { PurchaseOrder, PurchaseOrderItem } from "@/core/entities";
import type { PurchaseOrderStatus } from "@/core/enums";
import type { PaginatedResult } from "@/core/types/pagination.types";

export interface PurchaseOrderPageParams {
  branchId?: string;
  supplierId?: string;
  status?: PurchaseOrderStatus;
  /** Texto libre aplicado por el backend sobre las referencias históricas de la orden. */
  search?: string;
  page: number;
  pageSize: number;
}

export type PurchaseOrderItemInput = Omit<PurchaseOrderItem, "id" | "purchaseOrderId">;

export type CreatePurchaseOrderInput = Omit<
  PurchaseOrder,
  "id" | "number" | "items" | "createdAt" | "updatedAt"
> & {
  number?: string;
  items?: PurchaseOrderItemInput[];
};

export type UpdatePurchaseOrderInput = Partial<
  Omit<PurchaseOrder, "id" | "items" | "createdAt" | "updatedAt">
> & {
  items?: PurchaseOrderItemInput[];
};

export interface PurchaseOrderRepository {
  getAll(): Promise<PurchaseOrder[]>;
  getById(id: string): Promise<PurchaseOrder | null>;
  /**
   * Tenant-scoped, mismo patron que RoleRepository/BranchRepository -- permission-hardening
   * (feature/permission-hardening-purchasing-receiving): GetPurchaseOrdersReadModelService y
   * GetSuppliersReadModelService usaban getAll() sin filtro de tenant, exponiendo ordenes de
   * TODOS los tenants. getAll()/getById() se conservan sin cambios para consumidores fuera de
   * este PR (GetReportsService, GetInventoryMovementsService, PurchaseOrderPdfService) -- el
   * fix vive en los application services de Purchasing/Receiving, no en el contrato existente.
   */
  listByTenant(tenantId: string): Promise<PurchaseOrder[]>;
  getPageScoped(
    tenantId: string,
    params: PurchaseOrderPageParams,
  ): Promise<PaginatedResult<PurchaseOrder>>;
  getByIdScoped(tenantId: string, id: string): Promise<PurchaseOrder | null>;
  create(input: CreatePurchaseOrderInput): Promise<PurchaseOrder>;
  update(id: string, input: UpdatePurchaseOrderInput): Promise<PurchaseOrder>;
  /**
   * Variante tenant-scoped de `update`, para PurchaseOrderEditorService -- antes de este fix, el
   * service validaba tenant por su cuenta (`ensureOrderBelongsToTenant`) y despues llamaba a
   * `update(id, ...)` sin tenant: correcto hoy porque el guard corre justo antes, pero un cambio
   * futuro en el orden de las validaciones lo hubiera vuelto inseguro sin que el repository lo
   * impidiera. `updateScoped` hace la garantia estructural, no solo convencional.
   */
  updateScoped(tenantId: string, id: string, input: UpdatePurchaseOrderInput): Promise<PurchaseOrder>;
  updateStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder>;
  /**
   * Compatibilidad legacy para consumidores mock. Los flujos API de lifecycle usan las
   * operaciones semanticas tenant-scoped declaradas debajo; el backend no expone un endpoint
   * generico para cambiar status.
   */
  updateStatusScoped(
    tenantId: string,
    id: string,
    status: PurchaseOrderStatus,
  ): Promise<PurchaseOrder>;
  submitScoped(tenantId: string, id: string): Promise<PurchaseOrder>;
  approveScoped(tenantId: string, id: string): Promise<PurchaseOrder>;
  cancelScoped(tenantId: string, id: string, reason: string): Promise<PurchaseOrder>;
}
