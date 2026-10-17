import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { RoleDto } from "@/modules/administration/application/dto/RoleDto";
import { toRoleDto } from "@/modules/administration/application/mappers/RoleMapper";
import {
  ensureCanReadRoles,
  ensureRoleTenant,
} from "@/modules/administration/application/services/serviceHelpers";

export class GetRolesService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, permissions: readonly string[]): Promise<RoleDto[]> {
    ensureCanReadRoles(permissions);
    ensureRoleTenant(tenantId);
    const roles = await this.repositories.roles.listByTenant(tenantId);

    return roles.map(toRoleDto);
  }
}
