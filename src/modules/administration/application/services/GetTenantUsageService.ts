import { BranchStatus, SaasLimitKey, UserStatus, UserType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { TenantUsageDto } from "@/modules/administration/application/dto/SubscriptionDto";
import { ensurePlanTenant } from "@/modules/administration/application/services/serviceHelpers";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

/**
 * Consumo real tenant-scoped -- nunca `getAll()` + filtrado en la UI. Employees: `User.type ==
 * employee && status != archived` (un empleado `inactive`/`blocked` todavía cuenta contra el
 * límite; solo `archived` deja de contar, mismo criterio que Branches). Branches: `status !=
 * archived` vía `BranchRepository.listByTenant` (no `getActiveByTenant`: una sucursal
 * `inactive` sigue existiendo y cuenta, no es lo mismo que `archived`).
 */
export class GetTenantUsageService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string): Promise<TenantUsageDto> {
    ensurePlanTenant(tenantId);

    const [entitlements, users, branches] = await Promise.all([
      new ResolveTenantEntitlementsService(this.repositories).execute(tenantId),
      this.repositories.users.listByTenant(tenantId),
      this.repositories.branches.listByTenant(tenantId),
    ]);

    const employeesCurrent = users.filter(
      (user) => user.type === UserType.employee && user.status !== UserStatus.archived,
    ).length;
    const branchesCurrent = branches.filter(
      (branch) => branch.status !== BranchStatus.archived,
    ).length;

    return {
      employees: {
        current: employeesCurrent,
        limit: entitlements.limits[SaasLimitKey.maxEmployees] ?? null,
      },
      branches: {
        current: branchesCurrent,
        limit: entitlements.limits[SaasLimitKey.maxBranches] ?? null,
      },
    };
  }
}
