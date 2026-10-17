import type { Branch } from "@/core/entities";
import type { BranchType } from "@/core/enums";
export interface BranchRepository {
  getAll(): Promise<Branch[]>;
  getById(id: string): Promise<Branch | null>;
  getByIdScoped(tenantId: string, id: string): Promise<Branch | null>;
  getActive(): Promise<Branch[]>;
  getActiveByTenant(tenantId: string): Promise<Branch[]>;
  /**
   * Todas las branches del tenant sin filtrar por status (a diferencia de
   * `getActiveByTenant`) -- pensado para usage/conteos donde una sucursal `inactive`
   * todavía cuenta contra el límite del plan y solo `archived` deja de contar (mismo
   * patrón que `UserRepository.listByTenant`).
   */
  listByTenant(tenantId: string): Promise<Branch[]>;
  getActiveByTenantAndType(tenantId: string, type: BranchType): Promise<Branch[]>;
  create(input: Omit<Branch, "id" | "createdAt" | "updatedAt">): Promise<Branch>;
  update(
    id: string,
    input: Partial<Omit<Branch, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Branch>;
}
