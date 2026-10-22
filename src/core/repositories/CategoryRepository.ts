import type { Category } from "@/core/entities";

/**
 * Productos asociados DIRECTAMENTE a una categoria (sin sumar subcategorias). `null` significa que
 * el dato no esta disponible (por ejemplo, una respuesta anterior al contrato de conteos): nunca
 * debe presentarse como cero. Cero solo lo informa la fuente cuando realmente no hay productos.
 */
export interface CategoryProductCounts {
  /** Productos publicados. */
  productCount: number | null;
  archivedProductCount: number | null;
}

export interface CategoryWithCounts {
  category: Category;
  counts: CategoryProductCounts;
}

export interface CategoryRepository {
  getAll(): Promise<Category[]>;
  getByTenant(tenantId: string): Promise<Category[]>;
  /** Listado administrativo con conteos reales por categoria (una sola consulta, sin N+1). */
  getByTenantWithCounts(tenantId: string): Promise<CategoryWithCounts[]>;
  getById(id: string): Promise<Category | null>;
  getByIdScoped(tenantId: string, id: string): Promise<Category | null>;
  getActive(): Promise<Category[]>;
  getActiveByTenant(tenantId: string): Promise<Category[]>;
  create(input: Omit<Category, "id" | "createdAt" | "updatedAt">): Promise<Category>;
  update(
    id: string,
    input: Partial<Omit<Category, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Category>;
  updateScoped(
    tenantId: string,
    id: string,
    input: Partial<Omit<Category, "id" | "tenantId" | "createdAt" | "updatedAt">>,
  ): Promise<Category>;
  uploadImage(id: string, file: Blob): Promise<Category>;
  removeImage(id: string): Promise<Category>;
  archive(id: string): Promise<Category>;
  archiveScoped(tenantId: string, id: string): Promise<Category>;
}
