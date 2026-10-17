import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BranchDto, BranchInputDto } from "@/modules/administration/application/dto/BranchDto";
import { toBranchDto } from "@/modules/administration/application/mappers/BranchMapper";
import {
  AdministrationServiceError,
  ensureBranchActor,
  ensureBranchTenant,
  ensureCanManageBranches,
  ensureTenantCanCreateBranch,
  ensureValidBranchInput,
  normalizeBranchInput,
} from "@/modules/administration/application/services/serviceHelpers";

export class CreateBranchService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    dto: BranchInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<BranchDto> {
    ensureCanManageBranches(permissions);
    ensureBranchTenant(tenantId);
    ensureBranchActor(actorUserId);
    ensureValidBranchInput(dto);
    // límite SaaS del Plan (auditoría §24) -- antes de la unicidad de código, mismo criterio que
    // CreateEmployeeService.
    await ensureTenantCanCreateBranch(this.repositories, tenantId);

    const input = normalizeBranchInput(dto);
    await this.ensureUniqueCode(tenantId, input.code);

    const branch = await this.repositories.branches.create({ tenantId, ...input });
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "branch.created",
      entityType: "Branch",
      entityId: branch.id,
      metadata: {
        code: branch.code,
        name: branch.name,
        type: branch.type,
        status: branch.status,
      },
    });

    return toBranchDto(branch);
  }

  private async ensureUniqueCode(tenantId: string, code: string) {
    const tenantBranches = (await this.repositories.branches.getAll()).filter(
      (branch) => branch.tenantId === tenantId,
    );
    if (tenantBranches.some((branch) => branch.code.trim().toUpperCase() === code)) {
      throw new AdministrationServiceError("Ya existe una sucursal con ese código.");
    }
  }
}
