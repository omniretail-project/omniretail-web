import type { SupplierCostTier, SupplierProduct } from "@/core/entities";

export interface SupplierProductRepository {
  /** Lectura activa legacy/administrativa por producto. */
  getByProduct(productId: string): Promise<SupplierProduct[]>;
  /** Lectura activa legacy/administrativa por proveedor. */
  getBySupplier(supplierId: string): Promise<SupplierProduct[]>;
  /** Lectura operacional activa tenant-scoped por producto. */
  getByProductForTenant(tenantId: string, productId: string): Promise<SupplierProduct[]>;
  /** Incluye relaciones archivadas para que una sincronizacion pueda reactivarlas sin duplicar. */
  getAllByProductForTenant(tenantId: string, productId: string): Promise<SupplierProduct[]>;
  /** Lectura operacional activa tenant-scoped por proveedor. */
  getBySupplierForTenant(tenantId: string, supplierId: string): Promise<SupplierProduct[]>;
  create(input: Omit<SupplierProduct, "id" | "createdAt" | "updatedAt">): Promise<SupplierProduct>;
  /** Tenant-scoped write: `id` must belong to `tenantId`, otherwise treated as not found. */
  update(
    tenantId: string,
    id: string,
    input: Partial<Omit<SupplierProduct, "id" | "createdAt" | "updatedAt">>,
  ): Promise<SupplierProduct>;
  /** Tenant-scoped write: `id` must belong to `tenantId`, otherwise treated as not found. */
  archive(tenantId: string, id: string): Promise<SupplierProduct>;
  /** Tenant-scoped write: `supplierProductId` must belong to `tenantId`, otherwise treated as not found. */
  setPreferred(
    tenantId: string,
    productId: string,
    supplierProductId: string,
  ): Promise<SupplierProduct>;
  /** Lectura legacy/administrativa cuando la relacion no incluye `costTiers`. */
  getCostTiers(supplierProductId: string): Promise<SupplierCostTier[]>;
  /** Tenant-scoped write: `supplierProductId` must belong to `tenantId`, otherwise treated as not found. */
  replaceCostTiers(
    tenantId: string,
    supplierProductId: string,
    tiers: Omit<SupplierCostTier, "id" | "supplierProductId">[],
  ): Promise<SupplierCostTier[]>;
}
