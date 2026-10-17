import { BranchStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BranchDto } from "@/modules/administration/application/dto/BranchDto";
import { toBranchDto } from "@/modules/administration/application/mappers/BranchMapper";
import {
  ensureBranchBelongsToTenant,
  ensureBranchActor,
  ensureBranchTenant,
  ensureCanManageBranches,
} from "@/modules/administration/application/services/serviceHelpers";

export class ArchiveBranchService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    branchId: string,
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

    const branch = ensureBranchBelongsToTenant(
      await this.repositories.branches.update(current.id, { status: BranchStatus.archived }),
      tenantId,
    );
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "branch.archived",
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
}
