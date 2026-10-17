import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BranchDto } from "@/modules/administration/application/dto/BranchDto";
import { toBranchDto } from "@/modules/administration/application/mappers/BranchMapper";
import {
  ensureBranchTenant,
  ensureCanReadBranches,
} from "@/modules/administration/application/services/serviceHelpers";

export class GetBranchesService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, permissions: readonly string[]): Promise<BranchDto[]> {
    ensureCanReadBranches(permissions);
    ensureBranchTenant(tenantId);
    const branches = await this.repositories.branches.getAll();

    return branches.filter((branch) => branch.tenantId === tenantId).map(toBranchDto);
  }
}
