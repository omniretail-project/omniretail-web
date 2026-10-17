import type { Supplier, SupplierProduct } from "@/core/entities";
import type { SupplierStatus } from "@/core/enums";
import type { PaginatedResult } from "@/core/types";

/**
 * Proyeccion operacional disponible para compras. Deliberadamente no incluye datos
 * administrativos que `/purchasing/suppliers/active` no entrega.
 */
export interface OperationalSupplier {
  id: string;
  name: string;
  leadTimeDays?: number;
  status: SupplierStatus;
}

/** Fila del listado informativo de Compras (GET /purchasing/suppliers). */
export interface OperationalSupplierSummary {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  leadTimeDays?: number;
  status: SupplierStatus;
}

/** Detalle on-demand (GET /purchasing/suppliers/{id}). */
export interface OperationalSupplierDetail extends OperationalSupplierSummary {
  address?: string;
  notes?: string;
}

export interface OperationalSupplierPageParams {
  status?: SupplierStatus;
  search?: string;
  /** Base 1, igual que el backend. */
  page: number;
  pageSize: number;
}

export interface OperationalSupplierCostTier {
  minQuantity: number;
  unitCost: number;
}

/** Producto de un proveedor para la pestana informativa (GET /purchasing/suppliers/{id}/products). */
export interface OperationalSupplierProduct {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  supplierSku?: string;
  purchaseUnitSymbol: string;
  purchaseToBaseFactor: number;
  lastCost: number;
  leadTimeDays?: number;
  minimumOrderQuantity: number;
  preferred: boolean;
  active: boolean;
  costTiers: OperationalSupplierCostTier[];
}

export interface OperationalSupplierProductPageParams {
  /** Base 1, igual que el backend. */
  page: number;
  pageSize: number;
  active?: boolean;
  search?: string;
}

export type OperationalSupplierIncidentStatus = "open" | "resolved";

/** Incidencia de recepcion de un proveedor (GET /purchasing/suppliers/{id}/incidents). */
export interface OperationalSupplierIncident {
  id: string;
  incidentType: string;
  status: OperationalSupplierIncidentStatus;
  /** null en incidencias generales. */
  quantityAffected?: number;
  notes: string;
  createdAt: string;
  resolvedAt?: string;
  goodsReceiptId: string;
  receiptNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  branchId: string;
  productId?: string;
  productName?: string;
}

export interface OperationalSupplierIncidentPageParams {
  /** Base 1, igual que el backend. */
  page: number;
  pageSize: number;
  status?: OperationalSupplierIncidentStatus;
  branchId?: string;
}

export interface SupplierRepository {
  /** Solo modo API: productos del proveedor, paginados y filtrados en servidor. */
  getOperationalProducts(
    supplierId: string,
    params: OperationalSupplierProductPageParams,
  ): Promise<PaginatedResult<OperationalSupplierProduct>>;
  /** Solo modo API: incidencias del proveedor, paginadas y filtradas en servidor. */
  getOperationalIncidents(
    supplierId: string,
    params: OperationalSupplierIncidentPageParams,
  ): Promise<PaginatedResult<OperationalSupplierIncident>>;
  /** Solo modo API: listado informativo paginado en servidor (sin permisos administrativos). */
  getOperationalPage(
    params: OperationalSupplierPageParams,
  ): Promise<PaginatedResult<OperationalSupplierSummary>>;
  /** Solo modo API: detalle de un proveedor, cargado bajo demanda. */
  getOperationalById(id: string): Promise<OperationalSupplierDetail | null>;
  getAll(): Promise<Supplier[]>;
  getById(id: string): Promise<Supplier | null>;
  getActive(): Promise<Supplier[]>;
  /**
   * Operational read for active suppliers. API implementations are tenant-scoped by the
   * authenticated session; `tenantId` remains as a local architectural scope and is not wire data.
   */
  getActiveByTenant(tenantId: string): Promise<OperationalSupplier[]>;
  /**
   * Tenant-scoped, todos los status (mismo patron que PurchaseOrderRepository/BranchRepository.
   * listByTenant) -- permission-hardening PR #98: GetPurchaseOrdersReadModelService usaba
   * getAll() sin filtro de tenant, exponiendo suppliers de todos los tenants en el read model.
   * A diferencia de `getActiveByTenant` (solo activos, pensado para dropdowns de alta), este
   * incluye archivados: un read model de ordenes ya existentes debe poder resolver el nombre de
   * un proveedor archivado, no solo de los que se pueden elegir para una orden nueva.
   */
  listByTenant(tenantId: string): Promise<Supplier[]>;
  getProductsBySupplier(supplierId: string): Promise<SupplierProduct[]>;
  create(
    input: Omit<Supplier, "id" | "createdAt" | "updatedAt" | "leadTimeDays">,
  ): Promise<Supplier>;
  update(
    id: string,
    input: Partial<Omit<Supplier, "id" | "createdAt" | "updatedAt" | "leadTimeDays">>,
  ): Promise<Supplier>;
  archive(id: string): Promise<Supplier>;
}
