import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BranchDto, BranchInputDto } from "@/modules/administration/application/dto/BranchDto";
import { toBranchDto } from "@/modules/administration/application/mappers/BranchMapper";
import {
  AdministrationServiceError,
  ensureBranchActor,
  ensureBranchBelongsToTenant,
  ensureBranchTenant,
  ensureCanManageBranches,
  ensureValidBranchInput,
  normalizeBranchInput,
} from "@/modules/administration/application/services/serviceHelpers";

export class UpdateBranchService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    branchId: string,
    dto: BranchInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<BranchDto> {
    ensureCanManageBranches(permissions);
    ensureBranchTenant(tenantId);
    ensureBranchActor(actorUserId);
    const current = ensureBranchBelongsToTenant(
      await this.repositories.branches.getById(branchId),
      tenantId,
    );
    ensureValidBranchInput(dto);

    const input = normalizeBranchInput(dto);
    await this.ensureUniqueCode(tenantId, current.id, input.code);

    const branch = ensureBranchBelongsToTenant(
      await this.repositories.branches.update(current.id, input),
      tenantId,
    );
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "branch.updated",
      entityType: "Branch",
      entityId: branch.id,
      metadata: {
        code: branch.code,
        previousStatus: current.status,
        status: branch.status,
      },
    });

    return toBranchDto(branch);
  }

  private async ensureUniqueCode(tenantId: string, branchId: string, code: string) {
    const tenantBranches = (await this.repositories.branches.getAll()).filter(
      (branch) => branch.tenantId === tenantId,
    );
    if (
      tenantBranches.some(
        (branch) => branch.id !== branchId && branch.code.trim().toUpperCase() === code,
      )
    ) {
      throw new AdministrationServiceError("Ya existe una sucursal con ese código.");
    }
  }
}
