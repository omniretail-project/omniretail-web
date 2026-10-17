import { isApiMode } from "@/config/api-mode";
import { RoleStatus } from "@/core/enums";
import { canUserAccessBranch } from "@/core/scopes/userBranchAccess";
import { backendFetch } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { CashShiftDto } from "@/modules/administration/application/dto/CashShiftDto";
import { toCashShiftDto } from "@/modules/administration/application/mappers/CashShiftMapper";
import {
  AdministrationServiceError,
  ensureCanReadCash,
  ensureCashActor,
  ensureCashTenant,
} from "@/modules/administration/application/services/serviceHelpers";

export class GetCashShiftsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    actorUserId: string,
    permissions: readonly string[],
  ): Promise<CashShiftDto[]> {
    ensureCanReadCash(permissions);
    ensureCashTenant(tenantId);
    ensureCashActor(actorUserId);

    if (isApiMode()) {
      return backendFetch<CashShiftDto[]>("/administration/cash-shifts");
    }

    const actor = await this.repositories.users.getById(actorUserId);
    if (!actor || actor.tenantId !== tenantId) {
      throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
    }
    const role = actor.roleId
      ? await this.repositories.roles.getByIdScoped(tenantId, actor.roleId)
      : null;
    if (!role || role.status !== RoleStatus.active) {
      throw new AdministrationServiceError("No se pudo resolver el rol del usuario actual.");
    }

    const shifts = await this.repositories.cashShifts.listByTenant(tenantId);
    return shifts
      .filter((shift) =>
        canUserAccessBranch(actor, role, { id: shift.branchId, tenantId: shift.tenantId }),
      )
      .sort((left, right) => right.openedAt.localeCompare(left.openedAt))
      .map(toCashShiftDto);
  }
}
