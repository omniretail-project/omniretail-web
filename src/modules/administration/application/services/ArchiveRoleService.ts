import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { RoleDto } from "@/modules/administration/application/dto/RoleDto";
import { toRoleDto } from "@/modules/administration/application/mappers/RoleMapper";
import {
  ensureCanManageRoles,
  ensureRoleActor,
  ensureRoleBelongsToTenant,
  ensureRoleNotSystem,
  ensureRoleTenant,
} from "@/modules/administration/application/services/serviceHelpers";

export class ArchiveRoleService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    roleId: string,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<RoleDto> {
    ensureCanManageRoles(permissions);
    ensureRoleTenant(tenantId);
    ensureRoleActor(actorUserId);
    const current = ensureRoleBelongsToTenant(
      await this.repositories.roles.getByIdScoped(tenantId, roleId),
      tenantId,
    );
    ensureRoleNotSystem(current);

    const role = ensureRoleBelongsToTenant(
      await this.repositories.roles.archiveScoped(tenantId, current.id),
      tenantId,
    );
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "role.archived",
      entityType: "Role",
      entityId: role.id,
      metadata: {
        name: role.name,
        previousStatus: current.status,
        status: role.status,
      },
    });

    return toRoleDto(role);
  }
}
