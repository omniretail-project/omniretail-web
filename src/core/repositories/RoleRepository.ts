import type { Role } from "@/core/entities";

export interface RoleRepository {
  listByTenant(tenantId: string): Promise<Role[]>;
  getByIdScoped(tenantId: string, id: string): Promise<Role | null>;
  create(input: Omit<Role, "id" | "createdAt" | "updatedAt">): Promise<Role>;
  updateScoped(
    tenantId: string,
    id: string,
    input: Partial<Omit<Role, "id" | "tenantId" | "isSystem" | "createdAt" | "updatedAt">>,
  ): Promise<Role>;
  archiveScoped(tenantId: string, id: string): Promise<Role>;
}
