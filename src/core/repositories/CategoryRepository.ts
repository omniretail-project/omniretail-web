import type { Category } from "@/core/entities";
export interface CategoryRepository {
  getAll(): Promise<Category[]>;
  getByTenant(tenantId: string): Promise<Category[]>;
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
